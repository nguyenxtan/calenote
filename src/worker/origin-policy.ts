export const PRODUCTION_APP_ORIGIN = "https://calenote.iconiclogs.com";
export const LOCAL_DEVELOPMENT_APP_ORIGIN = "https://localhost:8787";

export type RuntimeOriginPolicy = {
  mode: "production" | "local";
  appOrigin: typeof PRODUCTION_APP_ORIGIN | typeof LOCAL_DEVELOPMENT_APP_ORIGIN;
};

type RuntimeEnvironment = {
  APP_ORIGIN?: unknown;
  CALENOTE_RUNTIME_ENVIRONMENT?: unknown;
};

export function resolveRuntimeOriginPolicy(
  env: RuntimeEnvironment,
  request: Request,
): RuntimeOriginPolicy | null {
  const requestOrigin = new URL(request.url).origin;
  if (
    env.CALENOTE_RUNTIME_ENVIRONMENT === "production"
    && env.APP_ORIGIN === PRODUCTION_APP_ORIGIN
    && requestOrigin === PRODUCTION_APP_ORIGIN
  ) {
    return { mode: "production", appOrigin: PRODUCTION_APP_ORIGIN };
  }
  if (
    env.CALENOTE_RUNTIME_ENVIRONMENT === "local"
    && env.APP_ORIGIN === LOCAL_DEVELOPMENT_APP_ORIGIN
    && requestOrigin === LOCAL_DEVELOPMENT_APP_ORIGIN
  ) {
    return { mode: "local", appOrigin: LOCAL_DEVELOPMENT_APP_ORIGIN };
  }
  return null;
}
