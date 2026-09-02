import { DatabaseSync } from "node:sqlite";
import { ExecucaoDeExtracao, STATUS_FINAIS, type EstadoDaExecucao } from "../../dominio/ExecucaoDeExtracao";
import type { RepositorioDeExecucoes } from "../../portas/RepositorioDeExecucoes";

const STATUS_FINAIS_SQL = [...STATUS_FINAIS].map((s) => `'${s}'`).join(", ");

const ESQUEMA = `
  CREATE TABLE IF NOT EXISTS execucoes (
    id TEXT PRIMARY KEY,
    status TEXT NOT NULL,
    criada_em TEXT NOT NULL,
    atualizada_em TEXT NOT NULL,
    reivindicada_em INTEGER,
    estado TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS ix_execucoes_pendentes ON execucoes (status, reivindicada_em, criada_em);
`;

export class RepositorioSqlite implements RepositorioDeExecucoes {
  private readonly db: DatabaseSync;

  constructor(caminho: string) {
    this.db = new DatabaseSync(caminho);
    this.db.exec("PRAGMA journal_mode = WAL");
    this.db.exec(ESQUEMA);
  }

  async salvar(execucao: ExecucaoDeExtracao): Promise<void> {
    const estado = execucao.snapshot();
    this.db
      .prepare(
        `INSERT INTO execucoes (id, status, criada_em, atualizada_em, reivindicada_em, estado)
         VALUES (?, ?, ?, ?, NULL, ?)
         ON CONFLICT(id) DO UPDATE SET
           status = excluded.status,
           atualizada_em = excluded.atualizada_em,
           estado = excluded.estado`,
      )
      .run(estado.id, estado.status, estado.criadaEm, estado.atualizadaEm, JSON.stringify(estado));
  }

  async obter(id: string): Promise<ExecucaoDeExtracao | null> {
    const linha = this.db.prepare("SELECT estado FROM execucoes WHERE id = ?").get(id) as { estado: string } | undefined;
    return linha ? this.hidratar(linha.estado) : null;
  }

  async reivindicarMaisAntigaPendente(agora: Date, reivindicacaoExpiraAposMs: number): Promise<ExecucaoDeExtracao | null> {
    const limite = agora.getTime() - reivindicacaoExpiraAposMs;
    const linha = this.db
      .prepare(
        `UPDATE execucoes
           SET reivindicada_em = ?
         WHERE id = (
           SELECT id FROM execucoes
            WHERE status NOT IN (${STATUS_FINAIS_SQL})
              AND (reivindicada_em IS NULL OR reivindicada_em < ?)
            ORDER BY criada_em ASC
            LIMIT 1
         )
         RETURNING estado`,
      )
      .get(agora.getTime(), limite) as { estado: string } | undefined;

    return linha ? this.hidratar(linha.estado) : null;
  }

  async liberar(id: string): Promise<void> {
    this.db.prepare("UPDATE execucoes SET reivindicada_em = NULL WHERE id = ?").run(id);
  }

  fechar(): void {
    this.db.close();
  }

  private hidratar(json: string): ExecucaoDeExtracao {
    return ExecucaoDeExtracao.restaurar(JSON.parse(json) as EstadoDaExecucao);
  }
}
