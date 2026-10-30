"""Development-only local measurement. Bootstrap is explicit; measurement is offline."""
import argparse
import hashlib
import importlib.metadata
import json
import logging
from pathlib import Path
import socket
import sys
import tempfile
import warnings

MODEL = "gemini-2.5-flash-lite"
VERSION = "2.25.0"
ARTIFACT_SHA256 = "1299c11d7cf632ef3b4e11937501358ada021bbdf7c47638d13c0ee982f2e79c"
CACHE = Path(__file__).resolve().parents[3] / "artifacts/context-contract-tokenizer/cache"
TOKENIZER = None
NETWORK_BLOCKED = False
NETWORK_ATTEMPTS = []
TEXT_ONLY = False


def block_network():
    global NETWORK_BLOCKED
    if not NETWORK_BLOCKED:
        def deny(event, args):
            if event in {"socket.connect", "socket.getaddrinfo", "socket.gethostbyname", "socket.gethostbyaddr", "socket.sendto", "socket.bind"}:
                NETWORK_ATTEMPTS.append(event)
                raise PermissionError("Offline tokenizer: network blocked")
        sys.addaudithook(deny)
        NETWORK_BLOCKED = True
    try:
        with socket.socket() as probe:
            probe.connect(("127.0.0.1", 9))
    except PermissionError:
        return True
    raise RuntimeError("Network guard failed")


def tokenizer(bootstrap=False):
    global TOKENIZER
    if TOKENIZER is not None:
        return TOKENIZER
    if importlib.metadata.version("google-genai") != VERSION:
        raise RuntimeError("Pinned SDK version mismatch")
    CACHE.mkdir(parents=True, exist_ok=True)
    tempfile.tempdir = str(CACHE)
    from google.genai import _local_tokenizer_loader as loader, local_tokenizer
    # urllib3 imports probe local IPv6 bind capability. The enclosing OS sandbox
    # denies networking throughout; audit the actual artifact/counting phase.
    if not bootstrap:
        block_network()
    if loader.get_tokenizer_name(MODEL) != "gemma3":
        raise RuntimeError("Tokenizer mapping changed")
    artifact = loader._TOKENIZERS["gemma3"]
    if artifact.model_hash != ARTIFACT_SHA256:
        raise RuntimeError("Published artifact hash mismatch")
    path = CACHE / "vertexai_tokenizer_model" / hashlib.sha1(artifact.model_url.encode()).hexdigest()
    if not bootstrap and (not path.exists() or hashlib.sha256(path.read_bytes()).hexdigest() != ARTIFACT_SHA256):
        raise RuntimeError("Verified artifact missing; run explicit --bootstrap first")
    TOKENIZER = local_tokenizer.LocalTokenizer(model_name=MODEL)
    return TOKENIZER


def measure(request):
    from google.genai import types
    from pydantic import ValidationError
    engine = tokenizer()
    original_schema = request["schemaJson"]
    schema = json.loads(original_schema)
    count = lambda text: engine.count_tokens(text).total_tokens
    prompt_tokens = count(request["prompt"])
    input_tokens = count(request["inputJson"])
    full_tokens = None
    unsupported = []
    if not TEXT_ONLY:
        try:
            # Entire canonical schema is submitted unchanged. Never prune/ref-expand.
            sdk_schema = types.Schema.model_validate(schema)
            full_tokens = engine.count_tokens(request["inputJson"], config=types.CountTokensConfig(
                system_instruction=request["prompt"], generation_config=types.GenerationConfig(response_schema=sdk_schema))).total_tokens
        except ValidationError as error:
            unsupported = [{"path": list(e["loc"]), "type": e["type"]} for e in error.errors()]
    return {
        "schemaUnchanged": original_schema == request["schemaJson"],
        "schemaSha256": hashlib.sha256(original_schema.encode()).hexdigest(),
        "promptTokens": prompt_tokens, "inputJsonTextTokens": input_tokens,
        "applicationTextTokens": prompt_tokens + input_tokens,
        "rawSchemaDiagnosticTokens": count(original_schema),
        "rawJsonDiagnosticTokens": count(request["wireJson"]),
        "sdkTextProjectionTokens": engine.count_tokens(request["inputJson"], config=types.CountTokensConfig(system_instruction=request["prompt"])).total_tokens,
        "sdkFullStructuredTokens": full_tokens, "unsupportedSchema": unsupported,
        "sdkFullStructuredUnavailableReason": "NOT_REQUESTED_DIAGNOSTIC_ONLY" if TEXT_ONLY else None,
        "outputTextTokens": count(request["outputJson"]) if request.get("outputJson") is not None else None,
        "routeFramingTokens": "UNKNOWN",
    }


def provenance():
    from google.genai import _local_tokenizer_loader as loader, local_tokenizer
    artifact = loader._TOKENIZERS["gemma3"]
    path = CACHE / "vertexai_tokenizer_model" / hashlib.sha1(artifact.model_url.encode()).hexdigest()
    proto = loader.load_model_proto("gemma3")
    return {"sdk": VERSION, "python": sys.version.split()[0], "model": MODEL, "tokenizer": "gemma3",
            "artifactUrl": artifact.model_url, "artifactSha256": hashlib.sha256(path.read_bytes()).hexdigest(), "artifactBytes": path.stat().st_size,
            "sdkSourcesSha256": {Path(m.__file__).name: hashlib.sha256(Path(m.__file__).read_bytes()).hexdigest() for m in [loader, local_tokenizer]},
            "normalizer": {"name": proto.normalizer_spec.name, "addDummyPrefix": proto.normalizer_spec.add_dummy_prefix, "removeExtraWhitespaces": proto.normalizer_spec.remove_extra_whitespaces, "escapeWhitespaces": proto.normalizer_spec.escape_whitespaces},
            "packages": {d.metadata["Name"]: d.version for d in importlib.metadata.distributions()},
            "networkGuardActive": NETWORK_BLOCKED, "networkAttemptsAfterSelfCheck": NETWORK_ATTEMPTS[1:]}


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--bootstrap", action="store_true")
    parser.add_argument("--text-only", action="store_true")
    args = parser.parse_args()
    TEXT_ONLY = args.text_only
    warnings.filterwarnings("ignore", message=".*local tokenizer.*")
    logging.getLogger("google_genai.local_tokenizer").setLevel(logging.ERROR)
    if args.bootstrap:
        tokenizer(bootstrap=True)
        print(json.dumps({"phase": "BOOTSTRAP_DOWNLOAD", "provenance": provenance()}))
    else:
        tokenizer()
        rows = [{"case": row["case"], **measure(row)} for row in json.load(sys.stdin)]
        print(json.dumps({"phase": "OFFLINE_MEASUREMENT", "provenance": provenance(), "rows": rows}))
