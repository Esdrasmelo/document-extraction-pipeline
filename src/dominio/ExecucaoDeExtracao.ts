import { randomUUID } from "node:crypto";
import { camposVazios, type CamposDoDocumento } from "./CamposDoDocumento";
import { TransicaoInvalida } from "./erros";

export const StatusDaExecucao = {
  RECEBIDA: "RECEBIDA",
  OCR_EM_ANDAMENTO: "OCR_EM_ANDAMENTO",
  OCR_CONCLUIDO: "OCR_CONCLUIDO",
  INTERPRETACAO_EM_ANDAMENTO: "INTERPRETACAO_EM_ANDAMENTO",
  CONCLUIDA: "CONCLUIDA",
  FALHOU: "FALHOU",
} as const;
export type StatusDaExecucao = (typeof StatusDaExecucao)[keyof typeof StatusDaExecucao];

export const STATUS_FINAIS: ReadonlySet<StatusDaExecucao> = new Set([
  StatusDaExecucao.CONCLUIDA,
  StatusDaExecucao.FALHOU,
]);

export const Etapa = {
  RECEBIMENTO: "RECEBIMENTO",
  INICIO_OCR: "INICIO_OCR",
  CONSULTA_OCR: "CONSULTA_OCR",
  TEXTO_MONTADO: "TEXTO_MONTADO",
  INTERPRETACAO_PULADA: "INTERPRETACAO_PULADA",
  INTERPRETACAO_ENVIADA: "INTERPRETACAO_ENVIADA",
  RESPOSTA_RECEBIDA: "RESPOSTA_RECEBIDA",
  VALIDACAO: "VALIDACAO",
  FALHA: "FALHA",
} as const;
export type Etapa = (typeof Etapa)[keyof typeof Etapa];

export const Nivel = { INFO: "INFO", AVISO: "AVISO", ERRO: "ERRO" } as const;
export type Nivel = (typeof Nivel)[keyof typeof Nivel];

export interface EventoDeExtracao {
  etapa: Etapa;
  nivel: Nivel;
  quando: string;
  dados?: Record<string, unknown>;
}

export interface ReferenciaDeDocumento {
  id: string;
  nome: string;
  tipo: string;
  caminho: string;
}

export interface FalhaDaExecucao {
  codigo: string;
  mensagem: string;
}

export interface EstadoDaExecucao {
  id: string;
  documento: ReferenciaDeDocumento;
  status: StatusDaExecucao;
  jobDeOcr: string | null;
  textoExtraido: string | null;
  respostaBruta: string | null;
  campos: CamposDoDocumento | null;
  avisos: string[];
  falha: FalhaDaExecucao | null;
  eventos: EventoDeExtracao[];
  criadaEm: string;
  atualizadaEm: string;
  concluidaEm: string | null;
}

export class ExecucaoDeExtracao {
  private constructor(private estado: EstadoDaExecucao) {}

  static receber(documento: ReferenciaDeDocumento, agora: Date, id: string = randomUUID()): ExecucaoDeExtracao {
    const execucao = new ExecucaoDeExtracao({
      id,
      documento,
      status: StatusDaExecucao.RECEBIDA,
      jobDeOcr: null,
      textoExtraido: null,
      respostaBruta: null,
      campos: null,
      avisos: [],
      falha: null,
      eventos: [],
      criadaEm: agora.toISOString(),
      atualizadaEm: agora.toISOString(),
      concluidaEm: null,
    });
    execucao.registrar(Etapa.RECEBIMENTO, Nivel.INFO, agora, { nome: documento.nome, tipo: documento.tipo });
    return execucao;
  }

  static restaurar(estado: EstadoDaExecucao): ExecucaoDeExtracao {
    return new ExecucaoDeExtracao({ ...estado, eventos: [...estado.eventos], avisos: [...estado.avisos] });
  }

  get id(): string {
    return this.estado.id;
  }

  get status(): StatusDaExecucao {
    return this.estado.status;
  }

  get documento(): ReferenciaDeDocumento {
    return this.estado.documento;
  }

  get jobDeOcr(): string | null {
    return this.estado.jobDeOcr;
  }

  get textoExtraido(): string | null {
    return this.estado.textoExtraido;
  }

  get campos(): CamposDoDocumento | null {
    return this.estado.campos;
  }

  get falha(): FalhaDaExecucao | null {
    return this.estado.falha;
  }

  get eventos(): ReadonlyArray<EventoDeExtracao> {
    return this.estado.eventos;
  }

  get terminou(): boolean {
    return STATUS_FINAIS.has(this.estado.status);
  }

  snapshot(): EstadoDaExecucao {
    return { ...this.estado, eventos: [...this.estado.eventos], avisos: [...this.estado.avisos] };
  }

  iniciarOcr(jobId: string, agora: Date): void {
    this.transicionar(StatusDaExecucao.RECEBIDA, StatusDaExecucao.OCR_EM_ANDAMENTO, agora);
    this.estado.jobDeOcr = jobId;
    this.registrar(Etapa.INICIO_OCR, Nivel.INFO, agora, { jobId });
  }

  registrarOcrPendente(agora: Date): void {
    this.exigir(StatusDaExecucao.OCR_EM_ANDAMENTO, "registrar consulta de OCR");
    this.registrar(Etapa.CONSULTA_OCR, Nivel.INFO, agora, { concluido: false });
    this.tocar(agora);
  }

  concluirOcr(texto: string, paginas: number, agora: Date): void {
    this.transicionar(StatusDaExecucao.OCR_EM_ANDAMENTO, StatusDaExecucao.OCR_CONCLUIDO, agora);
    this.estado.textoExtraido = texto;
    this.registrar(Etapa.TEXTO_MONTADO, Nivel.INFO, agora, { caracteres: texto.length, paginas });
  }

  concluirSemTexto(agora: Date): void {
    this.transicionar(StatusDaExecucao.OCR_CONCLUIDO, StatusDaExecucao.CONCLUIDA, agora);
    this.estado.campos = camposVazios();
    this.estado.concluidaEm = agora.toISOString();
    this.registrar(Etapa.INTERPRETACAO_PULADA, Nivel.AVISO, agora, { motivo: "texto vazio após OCR" });
  }

  iniciarInterpretacao(agora: Date): void {
    this.transicionar(StatusDaExecucao.OCR_CONCLUIDO, StatusDaExecucao.INTERPRETACAO_EM_ANDAMENTO, agora);
    this.registrar(Etapa.INTERPRETACAO_ENVIADA, Nivel.INFO, agora, { chaveIdempotente: this.estado.id });
  }

  reenviarInterpretacao(agora: Date): void {
    this.exigir(StatusDaExecucao.INTERPRETACAO_EM_ANDAMENTO, "reenviar interpretação");
    this.registrar(Etapa.INTERPRETACAO_ENVIADA, Nivel.AVISO, agora, {
      chaveIdempotente: this.estado.id,
      motivo: "reivindicação anterior expirou sem resposta",
    });
    this.tocar(agora);
  }

  concluir(campos: CamposDoDocumento, respostaBruta: string, avisos: string[], agora: Date): void {
    this.transicionar(StatusDaExecucao.INTERPRETACAO_EM_ANDAMENTO, StatusDaExecucao.CONCLUIDA, agora);
    this.estado.respostaBruta = respostaBruta;
    this.estado.campos = campos;
    this.estado.avisos = [...avisos];
    this.estado.concluidaEm = agora.toISOString();
    this.registrar(Etapa.RESPOSTA_RECEBIDA, Nivel.INFO, agora, { caracteres: respostaBruta.length });
    this.registrar(Etapa.VALIDACAO, avisos.length ? Nivel.AVISO : Nivel.INFO, agora, { avisos });
  }

  falhar(codigo: string, mensagem: string, agora: Date, respostaBruta: string | null = null): void {
    if (this.terminou) throw new TransicaoInvalida(this.estado.status, StatusDaExecucao.FALHOU);
    this.estado.status = StatusDaExecucao.FALHOU;
    this.estado.falha = { codigo, mensagem };
    this.estado.respostaBruta = respostaBruta ?? this.estado.respostaBruta;
    this.estado.concluidaEm = agora.toISOString();
    this.registrar(Etapa.FALHA, Nivel.ERRO, agora, { codigo, mensagem });
    this.tocar(agora);
  }

  private transicionar(de: StatusDaExecucao, para: StatusDaExecucao, agora: Date): void {
    if (this.estado.status !== de) throw new TransicaoInvalida(this.estado.status, para);
    this.estado.status = para;
    this.tocar(agora);
  }

  private exigir(status: StatusDaExecucao, acao: string): void {
    if (this.estado.status !== status) {
      throw new TransicaoInvalida(this.estado.status, `${acao} (exige ${status})`);
    }
  }

  private registrar(etapa: Etapa, nivel: Nivel, agora: Date, dados?: Record<string, unknown>): void {
    this.estado.eventos.push({ etapa, nivel, quando: agora.toISOString(), dados });
  }

  private tocar(agora: Date): void {
    this.estado.atualizadaEm = agora.toISOString();
  }
}
