# T0 development-only local tokenizer

This is a macOS measurement tool, not a Worker dependency or dispatch admission
implementation. It never creates `google.genai.Client`, fetches credentials or
calls inference/countTokens endpoints. Application dependencies are unchanged.

Use Python 3.12.14 (the measured interpreter); the selected SDK requires >=3.10.
Everything downloaded lives in Git-ignored `artifacts/context-contract-tokenizer/`.
The lock includes exact versions and distribution SHA-256 hashes of all 56
dependencies of the SDK's supported `local-tokenizer` extra. The extra includes
Torch/Transformers for other model mappings; this tool uses only gemma3's
SentencePiece artifact and downloads no full model weights.

Bootstrap (network permitted, package distribution and official artifact only):

```sh
uv venv --python /Users/bichtuyen/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3 artifacts/context-contract-tokenizer/venv
UV_CACHE_DIR=artifacts/context-contract-tokenizer/uv-cache uv pip sync --python artifacts/context-contract-tokenizer/venv/bin/python --require-hashes tools/benchmark/tokenizer/requirements.txt --index-url https://pypi.org/simple
artifacts/context-contract-tokenizer/venv/bin/python tools/benchmark/tokenizer/measure.py --bootstrap
```

The bootstrap verifies Google's pinned `gemma3` artifact hash. Measurement checks
that cached hash again before loading. The cache is under
`artifacts/context-contract-tokenizer/cache/vertexai_tokenizer_model/`; no global
Python or global tokenizer cache is changed. `requirements.in` pins the exact
bootstrap versions; `requirements.txt` is the generated hashed lock. To regenerate
only when explicitly updating the tool: `uv pip compile requirements.in
--generate-hashes --output-file requirements.txt` from this directory with the
same plan-owned `UV_CACHE_DIR` and Python path.

Offline verification (the bridge uses macOS `sandbox-exec` to deny all network
operations for the Python process; it does not fall back if sandboxing fails):

```sh
/usr/bin/sandbox-exec -p '(version 1)(allow default)(deny network*)' artifacts/context-contract-tokenizer/venv/bin/python -W ignore -m unittest discover -s tools/benchmark/tokenizer -p 'test_*.py'
CONTEXT_FIT_LOCAL_TOKENS=1 CONTEXT_FIT_REPORT=1 ./node_modules/.bin/vitest run tools/benchmark/context-contract-fit.test.ts tools/benchmark/snapshot-identity-view.test.ts --silent=false --disableConsoleIntercept
```

The bridge passes only PATH and Python reproducibility flags to its child, not
the application's environment. A Python audit hook additionally rejects DNS,
connect, sendto and bind during artifact loading/counting; it proves itself by
rejecting a loopback connect before the system call. Package imports precede the
audit phase because urllib3 probes local IPv6 bind capability during import;
the OS sandbox covers the entire process, including import. Any actual counting
phase network attempt fails and is reported. The subprocess output records the
active guard and zero counting-phase attempts after the deliberate self-check.

Results distinguish application prompt+input text, raw serialized request/schema
JSON diagnostics, the SDK's text projection, and its full structured projection.
The whole canonical response schema is supplied unchanged to `types.Schema`.
Validation errors are reported by path/type without pruning schema keywords or
logging fixture text. `sdkFullStructuredTokens=null` is UNKNOWN, not zero.
Output specimens are synthetic expected JSON objects, not observed model output.
No local token result can satisfy the production route gate.

`snapshot-identity-view.ts` is a T0 lossless storage experiment. It replaces only
an exactly duplicate transcript `semanticView` with `viewFromSource:true` in a
versioned JSON envelope and restores the original key order and complete value.
NFC-composed or control-projected views remain literal separate strings. Source
maps, facts, quotes, pending candidates and expiry are unchanged. Later state and
persistence tasks must adopt/revalidate this representation, count the complete
encoded pre-encryption snapshot, and prove transaction behavior. The tool is not
a persistence implementation.
