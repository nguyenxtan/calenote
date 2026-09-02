import { routeRequest } from "./router";

export default {
  fetch(request, env, ctx) {
    return routeRequest(request, env, ctx);
  },
  async queue(batch, env, ctx) {
    void batch;
    void env;
    void ctx;
  },
  async scheduled(controller, env, ctx) {
    void controller;
    void env;
    void ctx;
  },
} satisfies ExportedHandler<Env>;
