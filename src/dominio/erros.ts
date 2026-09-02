export class ErroDeDominio extends Error {
  constructor(
    message: string,
    public readonly codigo: string,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

export class TransicaoInvalida extends ErroDeDominio {
  constructor(de: string, para: string) {
    super(`Execução em ${de} não pode ir para ${para}`, "TRANSICAO_INVALIDA");
  }
}

export class RespostaDoModeloInvalida extends ErroDeDominio {
  constructor(
    message: string,
    public readonly detalhes: string[],
  ) {
    super(message, "RESPOSTA_INVALIDA");
  }
}

export class TipoDeDocumentoNaoSuportado extends ErroDeDominio {
  constructor(tipo: string) {
    super(`Tipo de documento não suportado por este adaptador: ${tipo}`, "TIPO_NAO_SUPORTADO");
  }
}
