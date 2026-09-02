import Fastify, { type FastifyInstance } from "fastify";
import { registrarRotas, type CasosDeUso } from "./rotas";

export async function montarServidor(casos: CasosDeUso): Promise<FastifyInstance> {
  const app = Fastify({ logger: false, bodyLimit: 30 * 1024 * 1024 });
  await registrarRotas(app, casos);
  return app;
}
