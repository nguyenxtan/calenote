const errorNames = ["Error", "TypeError", "SyntaxError", "RangeError", "ReferenceError", "URIError", "EvalError", "AggregateError", "AbortError", "TimeoutError"] as const;
const networkCodes = ["ECONNRESET", "ECONNREFUSED", "ENOTFOUND", "EAI_AGAIN", "ETIMEDOUT", "EPIPE", "ERR_NETWORK", "ABORT_ERR",
  "UND_ERR_CONNECT_TIMEOUT", "UND_ERR_HEADERS_TIMEOUT", "UND_ERR_BODY_TIMEOUT", "UND_ERR_SOCKET", "UND_ERR_ABORTED"] as const;
type NetworkCode = typeof networkCodes[number];

/** Only allowlisted response headers actually observed by the HTTP adapter. */
export interface SemanticHttpResponseCorrelation {
  httpStatus: number;
  requestId?: string;
  traceId?: string;
}

/** Content-free exception evidence only; never application or conversation state. */
export interface SemanticTransportDiagnostics {
  version: "gateway-exception-1";
  boundary: "TRANSPORT" | "DECODE";
  errorName: typeof errorNames[number] | "UNKNOWN";
  errorCode?: NetworkCode;
  causeCode?: NetworkCode;
  httpResponse?: Readonly<SemanticHttpResponseCorrelation>;
}

// Inspect data descriptors only. Error messages, stacks, headers, URLs and
// arbitrary getter values must never enter diagnostics (or be evaluated).
function ownData(value: unknown, key: "name" | "code" | "cause"): unknown {
  if (value === null || typeof value !== "object") return undefined;
  try {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return descriptor && "value" in descriptor ? descriptor.value : undefined;
  } catch { return undefined; }
}

function networkCode(value: unknown): NetworkCode | undefined {
  return typeof value === "string" && value.length <= 32 && (networkCodes as readonly string[]).includes(value) ? value as NetworkCode : undefined;
}

export function projectTransportException(error: unknown, boundary: SemanticTransportDiagnostics["boundary"]): SemanticTransportDiagnostics {
  let errorName: SemanticTransportDiagnostics["errorName"] = "UNKNOWN";
  let current = error;
  // Native Error names usually live on the immediate prototype. Bound the
  // lookup and stop at an explicit descriptor, including unsafe accessors.
  for (let depth = 0; depth < 3 && current !== null && typeof current === "object"; depth++) {
    try {
      const descriptor = Object.getOwnPropertyDescriptor(current, "name");
      if (descriptor) {
        const name = "value" in descriptor ? descriptor.value : undefined;
        if (typeof name === "string" && name.length <= 16 && (errorNames as readonly string[]).includes(name)) errorName = name as typeof errorNames[number];
        break;
      }
      current = Object.getPrototypeOf(current);
    } catch { break; }
  }
  const errorCode = networkCode(ownData(error, "code"));
  let causeCode: NetworkCode | undefined;
  current = error;
  // At most two cause edges, even for cycles or adversarial objects.
  for (let depth = 0; depth < 2 && !causeCode; depth++) {
    current = ownData(current, "cause");
    causeCode = networkCode(ownData(current, "code"));
  }
  return { version: "gateway-exception-1", boundary, errorName,
    ...(errorCode ? { errorCode } : {}), ...(causeCode ? { causeCode } : {}) };
}
