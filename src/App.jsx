import { useEffect, useRef, useState } from "react";
import { jsPDF } from "jspdf";
import * as pdfjsLib from "pdfjs-dist";
import pdfjsWorker from "pdfjs-dist/build/pdf.worker.mjs?url";
import Tesseract from "tesseract.js";
import "./App.css";

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorker;

// Informações fixas das etiquetas internas, conforme o modelo da empresa.
const EMPRESA = {
  nome: "SD Indústria e Comércio de Plásticos Ltda",
  telefones: "(47) 98818-1015 | (47) 99689-1110",
  email: "comercial@sdplasticos.com.br",
};

function dataHoje() {
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit", month: "2-digit", year: "numeric",
  }).format(new Date());
}

function abrirOuBaixarPDF(doc, nome, baixar) {
  if (baixar) {
    doc.save(nome);
    return;
  }
  const url = URL.createObjectURL(doc.output("blob"));
  const aba = window.open(url, "_blank");
  if (!aba) alert("A prévia foi bloqueada. Use Baixar PDF para visualizar.");
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}


const CHAVE_ETIQUETAS_INTERNAS = "gerador-etiquetas-internas-v1";

function carregarEtiquetasInternas() {
  try {
    const valor = JSON.parse(localStorage.getItem(CHAVE_ETIQUETAS_INTERNAS) || "[]");
    if (!Array.isArray(valor)) return [];
    return valor.filter((item) =>
      item && typeof item.id === "string" &&
      typeof item.produto === "string" &&
      typeof item.quantidade === "string"
    );
  } catch (erro) {
    console.warn("Não foi possível recuperar etiquetas salvas:", erro);
    return [];
  }
}

function App() {
  const inputRef = useRef(null);
  const [paginaAtual, setPaginaAtual] = useState("transporte");
  const [interno, setInterno] = useState({ produto: "", quantidade: "" });
  const [etiquetasSalvas, setEtiquetasSalvas] = useState(carregarEtiquetasInternas);
  const [avisoInterno, setAvisoInterno] = useState("");
  const [salvasAbertas, setSalvasAbertas] = useState(false);
  const [buscaSalvas, setBuscaSalvas] = useState("");

  useEffect(() => {
    try {
      localStorage.setItem(CHAVE_ETIQUETAS_INTERNAS, JSON.stringify(etiquetasSalvas));
    } catch (erro) {
      console.error("Não foi possível salvar etiquetas neste navegador:", erro);
      setAvisoInterno("O navegador não permitiu salvar os dados. Verifique o armazenamento disponível.");
    }
  }, [etiquetasSalvas]);

  const [arquivo, setArquivo] = useState(null);
  const [status, setStatus] = useState("");
  const [dados, setDados] = useState({
    destinatario: "",
    nf: "",
    volumes: "",
    tipoImpressao: "a4",
    etiquetasPorFolha: "8",
  });

  function abrirSeletorArquivo() {
    inputRef.current.click();
  }

  async function selecionarArquivo(event) {
    const file = event.target.files[0];

    if (!file) return;

    setArquivo(file);

    const dadosPeloNome = extrairDadosDoNomeArquivo(file.name);

    setDados((dadosAtuais) => ({
      ...dadosAtuais,
      nf: dadosPeloNome.nf || dadosAtuais.nf,
    }));

    setStatus("Lendo nota fiscal...");

    let dadosExtraidos = {
      destinatario: "",
      nf: "",
      volumes: "",
    };

    try {
      if (file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf")) {
        setStatus("Tentando ler o texto do PDF...");

        try {
          const textoPDF = await lerTextoDoPDF(file);
          console.log("TEXTO EXTRAÍDO DO PDF:", textoPDF);

          dadosExtraidos = extrairDadosDaNota(textoPDF);
        } catch (erroPDF) {
          console.error("Erro ao ler texto do PDF:", erroPDF);
        }

        const leituraIncompleta =
          !dadosExtraidos.destinatario || !dadosExtraidos.volumes;

        if (leituraIncompleta) {
          setStatus("Leitura do PDF incompleta. Tentando ler como imagem...");

          try {
            const textoOCR = await lerPDFComOCR(file);
            console.log("TEXTO EXTRAÍDO POR OCR DO PDF:", textoOCR);

            const dadosOCR = extrairDadosDaNota(textoOCR);

            dadosExtraidos = {
              destinatario:
                dadosExtraidos.destinatario || dadosOCR.destinatario || "",
              nf: dadosExtraidos.nf || dadosOCR.nf || "",
              volumes: dadosExtraidos.volumes || dadosOCR.volumes || "",
            };
          } catch (erroOCR) {
            console.error("Erro ao fazer OCR do PDF:", erroOCR);
          }
        }
      } else if (file.type.startsWith("image/")) {
        setStatus("Lendo imagem...");

        try {
          const textoImagem = await lerTextoDaImagem(file);
          console.log("TEXTO EXTRAÍDO DA IMAGEM:", textoImagem);

          dadosExtraidos = extrairDadosDaNota(textoImagem);
        } catch (erroImagem) {
          console.error("Erro ao ler imagem:", erroImagem);
        }
      } else {
        setStatus(
          "Formato não suportado para leitura automática. Preencha manualmente."
        );
        return;
      }

      const novosDados = {
        destinatario: dadosExtraidos.destinatario || "",
        nf: dadosExtraidos.nf || dadosPeloNome.nf || "",
        volumes: dadosExtraidos.volumes || "",
      };

      setDados((dadosAtuais) => ({
        ...dadosAtuais,
        destinatario: novosDados.destinatario,
        nf: novosDados.nf,
        volumes: novosDados.volumes,
      }));

      if (novosDados.destinatario && novosDados.volumes) {
        setStatus("Leitura concluída. Confira os dados antes de gerar.");
      } else if (novosDados.nf) {
        setStatus(
          "Leitura parcial. A NF foi identificada. Complete destinatário e volumes se necessário."
        );
      } else {
        setStatus(
          "Não foi possível ler automaticamente. Preencha os dados manualmente."
        );
      }
    } catch (error) {
      console.error("Erro geral:", error);

      setDados((dadosAtuais) => ({
        ...dadosAtuais,
        nf: dadosPeloNome.nf || dadosAtuais.nf,
      }));

      setStatus(
        "Não foi possível ler automaticamente. A NF foi preenchida pelo nome do arquivo, se identificada."
      );
    }
  }

  async function lerTextoDoPDF(file) {
    const arrayBuffer = await file.arrayBuffer();
    const typedArray = new Uint8Array(arrayBuffer);

    const pdf = await pdfjsLib.getDocument({
      data: typedArray,
    }).promise;

    let textoCompleto = "";

    for (let pagina = 1; pagina <= pdf.numPages; pagina++) {
      const page = await pdf.getPage(pagina);
      const content = await page.getTextContent();

      const textoPagina = content.items.map((item) => item.str).join("\n");
      textoCompleto += "\n" + textoPagina;
    }

    return textoCompleto.trim();
  }

  async function lerPDFComOCR(file) {
    const arrayBuffer = await file.arrayBuffer();
    const typedArray = new Uint8Array(arrayBuffer);

    const pdf = await pdfjsLib.getDocument({
      data: typedArray,
    }).promise;

    const page = await pdf.getPage(1);

    const viewport = page.getViewport({
      scale: 2,
    });

    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d", {
      willReadFrequently: true,
    });

    canvas.width = viewport.width;
    canvas.height = viewport.height;

    await page.render({
      canvasContext: context,
      viewport,
    }).promise;

    const imagem = canvas.toDataURL("image/png");

    let resultado;

    try {
      resultado = await Tesseract.recognize(imagem, "por", {
        logger: (m) => {
          if (m.status === "recognizing text") {
            const progresso = Math.round(m.progress * 100);
            setStatus(`Lendo PDF como imagem... ${progresso}%`);
          }
        },
      });
    } catch (erroPortugues) {
      console.error("Erro no OCR em português. Tentando inglês:", erroPortugues);

      resultado = await Tesseract.recognize(imagem, "eng", {
        logger: (m) => {
          if (m.status === "recognizing text") {
            const progresso = Math.round(m.progress * 100);
            setStatus(`Lendo PDF como imagem... ${progresso}%`);
          }
        },
      });
    }

    return resultado.data.text;
  }

  async function lerTextoDaImagem(file) {
    let resultado;

    try {
      resultado = await Tesseract.recognize(file, "por", {
        logger: (m) => {
          if (m.status === "recognizing text") {
            const progresso = Math.round(m.progress * 100);
            setStatus(`Lendo imagem... ${progresso}%`);
          }
        },
      });
    } catch (erroPortugues) {
      console.error("Erro no OCR em português. Tentando inglês:", erroPortugues);

      resultado = await Tesseract.recognize(file, "eng", {
        logger: (m) => {
          if (m.status === "recognizing text") {
            const progresso = Math.round(m.progress * 100);
            setStatus(`Lendo imagem... ${progresso}%`);
          }
        },
      });
    }

    return resultado.data.text;
  }

  function extrairDadosDaNota(texto) {
    const textoOriginal = texto || "";

    const textoNormalizado = textoOriginal
      .replace(/\r/g, "\n")
      .replace(/[ \t]+/g, " ")
      .replace(/\n+/g, "\n")
      .trim();

    let destinatario = "";
    let nf = "";
    let volumes = "";

    const matchDestinatario = textoNormalizado.match(
      /DESTINAT[ÁA]RIO[\s\S]*?NOME\s*\/\s*RAZ[ÃA]O\s*SOCIAL\s*\n\s*([^\n]+)/i
    );

    if (matchDestinatario) {
      destinatario = limparTextoEmpresa(matchDestinatario[1]);
    }

    if (!destinatario) {
      const matchDestinatarioBloco = textoNormalizado.match(
        /DESTINAT[ÁA]RIO[\s\S]{0,600}?([A-Z0-9 .&ÇÃÕÁÉÍÓÚ-]{5,100}(?:LTDA|EIRELI|ME|EPP|S\/A|SA))/i
      );

      if (matchDestinatarioBloco) {
        destinatario = limparTextoEmpresa(matchDestinatarioBloco[1]);
      }
    }

    if (!destinatario) {
      const empresas = textoNormalizado.match(
        /[A-Z0-9 .&ÇÃÕÁÉÍÓÚ-]{5,100}(?:LTDA|EIRELI|ME|EPP|S\/A|SA)/g
      );

      if (empresas && empresas.length > 0) {
        const empresasFiltradas = empresas
          .map((empresa) => limparTextoEmpresa(empresa))
          .filter((empresa) => {
            const empresaAlta = empresa.toUpperCase();

            return (
              empresaAlta.length > 5 &&
              !empresaAlta.includes("SD INDUSTRIA") &&
              !empresaAlta.includes("SD PLASTICOS") &&
              !empresaAlta.includes("FREELINE") &&
              !empresaAlta.includes("IDENTIFICAÇÃO") &&
              !empresaAlta.includes("DOCUMENTO AUXILIAR")
            );
          });

        destinatario = empresasFiltradas[0] || "";
      }
    }

    const matchNFCompleta = textoNormalizado.match(
      /N[º°o]\.?\s*0*\.?0*\.?0*([0-9]{1,3})\.?([0-9]{3})/i
    );

    if (matchNFCompleta) {
      nf = formatarNF(`${matchNFCompleta[1]}${matchNFCompleta[2]}`);
    }

    if (!nf) {
      const matchNFe = textoNormalizado.match(
        /NF-?e[\s\S]{0,120}?N[º°o]\.?\s*0*\.?0*\.?0*([0-9]{1,3})\.?([0-9]{3})/i
      );

      if (matchNFe) {
        nf = formatarNF(`${matchNFe[1]}${matchNFe[2]}`);
      }
    }

    if (!nf && arquivo?.name) {
      const matchArquivo = arquivo.name.match(/^(\d{4,6})/);

      if (matchArquivo) {
        nf = formatarNF(matchArquivo[1]);
      }
    }

    const matchVolumes = textoNormalizado.match(
      /TRANSPORTADOR[\s\S]*?VOLUMES[\s\S]*?QUANTIDADE\s*\n\s*(\d{1,3})/i
    );

    if (matchVolumes) {
      volumes = matchVolumes[1].trim();
    }

    if (!volumes) {
      const matchQuantidade = textoNormalizado.match(
        /QUANTIDADE\s+(\d{1,3})/i
      );

      if (matchQuantidade) {
        volumes = matchQuantidade[1].trim();
      }
    }

    if (!volumes) {
      const matchEspecie = textoNormalizado.match(/(\d{1,3})\s+SACO/i);

      if (matchEspecie) {
        volumes = matchEspecie[1].trim();
      }
    }

    if (!volumes) {
      const matchVolumesPalavra = textoNormalizado.match(
        /(\d{1,3})\s+(?:VOLUME|VOLUMES|VOL)/i
      );

      if (matchVolumesPalavra) {
        volumes = matchVolumesPalavra[1].trim();
      }
    }

    return {
      destinatario,
      nf,
      volumes,
    };
  }

  function limparTextoEmpresa(texto) {
    return String(texto)
      .replace(/CNPJ.*$/i, "")
      .replace(/CPF.*$/i, "")
      .replace(/DATA.*$/i, "")
      .replace(/ENDERE.*$/i, "")
      .replace(/BAIRRO.*$/i, "")
      .replace(/MUNIC.*$/i, "")
      .replace(/CEP.*$/i, "")
      .replace(/FONE.*$/i, "")
      .replace(/\s+/g, " ")
      .trim();
  }

  function atualizarCampo(campo, valor) {
    setDados((dadosAtuais) => ({
      ...dadosAtuais,
      [campo]: valor,
    }));
  }

  function extrairDadosDoNomeArquivo(nomeArquivo) {
    const match = nomeArquivo.match(/^(\d{4,6})/);

    if (!match) {
      return {
        nf: "",
      };
    }

    return {
      nf: formatarNF(match[1]),
    };
  }

  function limparFormulario() {
    setArquivo(null);
    setStatus("");
    setDados({
      destinatario: "",
      nf: "",
      volumes: "",
      tipoImpressao: "a4",
      etiquetasPorFolha: "8",
    });

    if (inputRef.current) {
      inputRef.current.value = "";
    }
  }

  function limparNumeroNF(nf) {
    return String(nf).replace(/[^\d]/g, "");
  }

  function formatarNF(nf) {
    const numeroLimpo = limparNumeroNF(nf);

    if (!numeroLimpo) return nf;

    const ultimosQuatro = numeroLimpo.slice(-4);

    return ultimosQuatro.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  }

  function quebrarTexto(doc, texto, larguraMaxima) {
    return doc.splitTextToSize(texto, larguraMaxima);
  }

  // PDF pronto para a Zebra ZD220: uma página de 100 x 150 mm por volume.
  function criarPDFZebra(destinatario, nf, totalVolumes) {
    const doc = new jsPDF({
      orientation: "portrait",
      unit: "mm",
      format: [100, 150],
    });

    for (let i = 1; i <= totalVolumes; i++) {
      if (i > 1) doc.addPage([100, 150], "portrait");

      doc.setDrawColor(0);
      doc.setLineWidth(0.45);
      doc.rect(4, 4, 92, 142);
      doc.setFont("helvetica", "bold");

      // Reduz a fonte quando o nome é longo para mantê-lo dentro da etiqueta.
      let tamanhoNome = 18;
      let linhasNome = [];
      do {
        doc.setFontSize(tamanhoNome);
        linhasNome = doc.splitTextToSize(destinatario.toUpperCase(), 82);
        if (linhasNome.length <= 3) break;
        tamanhoNome -= 1;
      } while (tamanhoNome > 9);

      const alturaLinhaNome = tamanhoNome * 0.45;
      const inicioNome = 30 - ((linhasNome.length - 1) * alturaLinhaNome) / 2;
      doc.text(linhasNome.slice(0, 4), 50, inicioNome, {
        align: "center",
        lineHeightFactor: 1.05,
      });

      doc.setLineWidth(0.3);
      doc.line(10, 55, 90, 55);

      let tamanhoNF = 25;
      const textoNF = `NF/${formatarNF(nf)}`;
      doc.setFontSize(tamanhoNF);
      while (doc.getTextWidth(textoNF) > 82 && tamanhoNF > 12) {
        tamanhoNF -= 1;
        doc.setFontSize(tamanhoNF);
      }
      doc.text(textoNF, 50, 76, { align: "center" });
      doc.line(10, 88, 90, 88);

      doc.setFontSize(19);
      doc.text("VOLUME", 50, 108, { align: "center" });

      let tamanhoVolume = 40;
      const textoVolume = `${i}/${totalVolumes}`;
      doc.setFontSize(tamanhoVolume);
      while (doc.getTextWidth(textoVolume) > 82 && tamanhoVolume > 14) {
        tamanhoVolume -= 1;
        doc.setFontSize(tamanhoVolume);
      }
      doc.text(textoVolume, 50, 130, { align: "center" });
    }

    return doc;
  }

  // Etiqueta interna horizontal no mesmo papel térmico de 100 x 150 mm.
  // O PDF é 150 x 100 mm, para lembrar o modelo horizontal da foto.
  function criarPDFInterno(baixar = true) {
    const produto = interno.produto.trim();
    const quantidade = interno.quantidade.trim();
    if (!produto || !/^\d+$/.test(quantidade) || Number(quantidade) < 1) {
      alert("Informe o nome do produto e uma quantidade válida de peças.");
      return;
    }

    const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: [100, 150] });
    const centro = 75;
    const larguraUtil = 136;
    doc.setDrawColor(0);
    doc.setLineWidth(0.45);
    doc.rect(4, 4, 142, 92);

    doc.setFont("helvetica", "bold");
    let fonteProduto = 21;
    let linhasProduto = [];
    do {
      doc.setFontSize(fonteProduto);
      linhasProduto = doc.splitTextToSize(produto.toUpperCase(), larguraUtil);
      if (linhasProduto.length <= 2) break;
      fonteProduto -= 1;
    } while (fonteProduto > 11);
    if (linhasProduto.length > 2) {
      alert("O nome do produto é muito longo para a etiqueta. Resuma o nome.");
      return;
    }
    const alturaLinha = fonteProduto * 0.4;
    const yProduto = 17 - (linhasProduto.length - 1) * alturaLinha / 2;
    doc.text(linhasProduto, centro, yProduto, { align: "center", lineHeightFactor: 1.1 });
    doc.setLineWidth(0.25);
    doc.line(8, 30, 142, 30);

    doc.setFont("helvetica", "normal");
    doc.setFontSize(13);
    doc.text("Quantidade:", 10, 44);
    doc.setFont("helvetica", "bold");
    let fonteQuantidade = 23;
    const qtdTexto = `${Number(quantidade).toLocaleString("pt-BR")} peças`;
    doc.setFontSize(fonteQuantidade);
    while (doc.getTextWidth(qtdTexto) > 94 && fonteQuantidade > 12) {
      fonteQuantidade -= 1;
      doc.setFontSize(fonteQuantidade);
    }
    doc.text(qtdTexto, 140, 44, { align: "right" });

    doc.setFont("helvetica", "normal");
    doc.setFontSize(11.5);
    doc.text("Responsável: __________________", 10, 60);
    doc.text(`Data: ${dataHoje()}`, 140, 60, { align: "right" });
    doc.line(8, 67, 142, 67);

    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.text(EMPRESA.nome, centro, 76, { align: "center" });
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9.8);
    doc.text(EMPRESA.telefones, centro, 84, { align: "center" });
    doc.text(EMPRESA.email, centro, 91, { align: "center" });

    const nomeSeguro = produto.toLowerCase()
      .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 45);
    abrirOuBaixarPDF(doc, `etiqueta-interna-${nomeSeguro || "produto"}.pdf`, baixar);
  }

  function limparInterno() {
    setInterno({ produto: "", quantidade: "" });
    setAvisoInterno("");
  }

  function salvarEtiquetaInterna() {
    const produto = interno.produto.trim().replace(/\s+/g, " ");
    const quantidade = interno.quantidade.trim();

    if (!produto || !/^\d+$/.test(quantidade) || !Number.isSafeInteger(Number(quantidade)) || Number(quantidade) < 1) {
      setAvisoInterno("Informe o nome do produto e uma quantidade válida antes de salvar.");
      return;
    }

    // O mesmo produto pode ter várias etiquetas, desde que a quantidade seja diferente.
    // Evitamos apenas duplicações exatas de produto + quantidade.
    const existente = etiquetasSalvas.find((item) =>
      item.produto.trim().toLocaleLowerCase("pt-BR") === produto.toLocaleLowerCase("pt-BR") &&
      Number(item.quantidade) === Number(quantidade)
    );

    if (existente) {
      setAvisoInterno("Essa combinação de produto e quantidade já está salva. Abra Etiquetas salvas para reutilizá-la.");
      return;
    }

    const id = typeof crypto !== "undefined" && crypto.randomUUID
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    setEtiquetasSalvas((atuais) => [...atuais, { id, produto, quantidade }]);
    setAvisoInterno("Etiqueta salva neste navegador. Você pode encontrá-la em Etiquetas salvas.");
  }

  function usarEtiquetaSalva(item) {
    setInterno({ produto: item.produto, quantidade: item.quantidade });
    setAvisoInterno(`Etiqueta de ${item.produto} carregada. Confira a quantidade antes de imprimir.`);
  }

  function excluirEtiquetaSalva(item) {
    if (!window.confirm(`Excluir a etiqueta de ${item.produto} (${Number(item.quantidade).toLocaleString("pt-BR")} peças)?`)) return;
    setEtiquetasSalvas((atuais) => atuais.filter((atual) => atual.id !== item.id));
    setAvisoInterno("Etiqueta excluída das salvas.");
  }

  function criarPDFEtiquetas(baixar = true) {
    const destinatario = dados.destinatario.trim();
    const nf = dados.nf.trim();
    const totalVolumes = Number(dados.volumes);
    const etiquetasPorFolha = Number(dados.etiquetasPorFolha);

    if (!destinatario || !nf || !Number.isInteger(totalVolumes) || totalVolumes < 1) {
      alert("Preencha destinatário, NF e uma quantidade inteira de volumes.");
      return;
    }

    if (totalVolumes > 500) {
      alert("O limite é 500 volumes por geração. Confira a quantidade informada.");
      return;
    }

    if (dados.tipoImpressao === "zebra") {
      const docZebra = criarPDFZebra(destinatario, nf, totalVolumes);
      if (baixar) {
        docZebra.save(`etiquetas-zebra-nf-${formatarNF(nf)}.pdf`);
      } else {
        const url = URL.createObjectURL(docZebra.output("blob"));
        const aba = window.open(url, "_blank");
        if (!aba) {
          alert("O navegador bloqueou a prévia. Use Baixar PDF para visualizar.");
        }
        setTimeout(() => URL.revokeObjectURL(url), 60000);
      }
      return;
    }

    const doc = new jsPDF({
      orientation: "portrait",
      unit: "mm",
      format: "a4",
    });

    const pagina = {
      largura: 210,
      altura: 297,
      margemX: 10,
      margemY: 10,
    };

    let colunas = 2;
    let linhas = 4;

    if (etiquetasPorFolha === 6) {
      colunas = 2;
      linhas = 3;
    }

    if (etiquetasPorFolha === 8) {
      colunas = 2;
      linhas = 4;
    }

    if (etiquetasPorFolha === 10) {
      colunas = 2;
      linhas = 5;
    }

    if (etiquetasPorFolha === 12) {
      colunas = 2;
      linhas = 6;
    }

    const larguraEtiqueta = (pagina.largura - pagina.margemX * 2) / colunas;
    const alturaEtiqueta = (pagina.altura - pagina.margemY * 2) / linhas;

    for (let i = 1; i <= totalVolumes; i++) {
      const indiceNaPagina = (i - 1) % etiquetasPorFolha;

      if (i > 1 && indiceNaPagina === 0) {
        doc.addPage();
      }

      const coluna = indiceNaPagina % colunas;
      const linha = Math.floor(indiceNaPagina / colunas);

      const x = pagina.margemX + coluna * larguraEtiqueta;
      const y = pagina.margemY + linha * alturaEtiqueta;

      doc.setDrawColor(180, 180, 180);
      doc.setLineWidth(0.1);
      doc.rect(x, y, larguraEtiqueta, alturaEtiqueta);

      doc.setDrawColor(0, 0, 0);
      doc.setLineWidth(0.35);
      doc.rect(x + 3, y + 3, larguraEtiqueta - 6, alturaEtiqueta - 6);

      const centroX = x + larguraEtiqueta / 2;
      const larguraTexto = larguraEtiqueta - 14;

      doc.setFont("helvetica", "bold");
      doc.setFontSize(etiquetasPorFolha >= 10 ? 11 : 13);

      const linhasDestinatario = quebrarTexto(doc, destinatario, larguraTexto);

      doc.text(linhasDestinatario, centroX, y + alturaEtiqueta * 0.25, {
        align: "center",
      });

      doc.setFont("helvetica", "bold");
      doc.setFontSize(etiquetasPorFolha >= 10 ? 20 : 25);
      doc.text(`NF/${formatarNF(nf)}`, centroX, y + alturaEtiqueta * 0.52, {
        align: "center",
      });

      doc.setFont("helvetica", "bold");
      doc.setFontSize(etiquetasPorFolha >= 10 ? 20 : 27);
      doc.text(`VOLUME ${i}/${totalVolumes}`, centroX, y + alturaEtiqueta * 0.78, {
        align: "center",
      });
    }

    if (baixar) {
      doc.save(`etiquetas-nf-${formatarNF(nf)}.pdf`);
      return;
    }

    const blob = doc.output("blob");
    const url = URL.createObjectURL(blob);
    window.open(url, "_blank");
  }

  return (
    <main className="page">
      <section className="card">
        <nav className="label-tabs" aria-label="Tipo de etiqueta">
          <button type="button" className={paginaAtual === "transporte" ? "label-tab active" : "label-tab"}
            onClick={() => setPaginaAtual("transporte")}>Transporte</button>
          <button type="button" className={paginaAtual === "interna" ? "label-tab active" : "label-tab"}
            onClick={() => setPaginaAtual("interna")}>Etiquetas internas</button>
        </nav>
        {paginaAtual === "transporte" ? (
        <>
        <div className="header">
          <div>
            <p className="tag">Sistema simples</p>
            <h1>Gerador de Etiquetas</h1>
            <p className="subtitle">
              Anexe uma nota fiscal, confira os dados e gere etiquetas em A4
              ou no formato térmico 100x150 mm.
            </p>
          </div>
        </div>

        <input
          ref={inputRef}
          type="file"
          accept=".pdf,image/*"
          onChange={selecionarArquivo}
          className="hidden-input"
        />

        <button
          className="upload-area"
          type="button"
          onClick={abrirSeletorArquivo}
        >
          <span className="upload-icon">📄</span>
          <strong>Adicionar nota fiscal</strong>
          <small>Tirar foto, escolher da galeria ou anexar documento</small>
        </button>

        {arquivo && (
          <div className="file-info">
            <span>Arquivo selecionado:</span>
            <strong>{arquivo.name}</strong>
          </div>
        )}

        {status && <div className="status-box">{status}</div>}

        <div className="form">
          <label>
            Destinatário
            <input
              type="text"
              value={dados.destinatario}
              onChange={(e) => atualizarCampo("destinatario", e.target.value)}
              placeholder="Ex: PERONDI ENGENHARIA LTDA"
            />
          </label>

          <label>
            Número da NF
            <input
              type="text"
              value={dados.nf}
              onChange={(e) => atualizarCampo("nf", e.target.value)}
              placeholder="Ex: 6.510"
            />
          </label>

          <label>
            Quantidade de volumes
            <input
              type="number"
              min="1"
              value={dados.volumes}
              onChange={(e) => atualizarCampo("volumes", e.target.value)}
              placeholder="Ex: 4"
            />
          </label>

          <label>
            Tipo de impressão
            <select
              value={dados.tipoImpressao}
              onChange={(e) => atualizarCampo("tipoImpressao", e.target.value)}
            >
              <option value="a4">Folha A4 - Impressora HP</option>
              <option value="zebra">Etiqueta térmica 100x150 - Zebra ZD220</option>
            </select>
          </label>

          {dados.tipoImpressao === "a4" && (
            <label>
              Etiquetas por folha A4
              <select
                value={dados.etiquetasPorFolha}
                onChange={(e) =>
                  atualizarCampo("etiquetasPorFolha", e.target.value)
                }
              >
                <option value="6">6 etiquetas - maior</option>
                <option value="8">8 etiquetas - recomendado</option>
                <option value="10">10 etiquetas - econômico</option>
                <option value="12">12 etiquetas - super econômico</option>
              </select>
            </label>
          )}
        </div>

        <div className="preview">
          <p>Prévia da etiqueta</p>

          <div className="label-preview">
            <strong>{dados.destinatario || "NOME DO DESTINATÁRIO"}</strong>
            <span>NF/{dados.nf ? formatarNF(dados.nf) : "0000"}</span>
            <b>VOLUME 1/{dados.volumes || "0"}</b>
          </div>
        </div>

        <div className="action-buttons">
          <button
            className="preview-button"
            type="button"
            onClick={() => criarPDFEtiquetas(false)}
          >
            Visualizar etiquetas
          </button>

          <button
            className="generate-button"
            type="button"
            onClick={() => criarPDFEtiquetas(true)}
          >
            Baixar PDF
          </button>
        </div>

        <button className="clear-button" type="button" onClick={limparFormulario}>
          Limpar / nova nota
        </button>
        </>
        ) : (
          <section className="internal-panel" aria-label="Etiquetas internas">
            <div className="header">
              <p className="tag">Identificação de produção</p>
              <h1>Etiquetas internas</h1>
              <p className="subtitle">Preencha apenas produto e quantidade. A data e os contatos são automáticos.</p>
            </div>

            <div className="form">
              <label>
                Nome do produto
                <input type="text" value={interno.produto}
                  onChange={(e) => setInterno((atual) => ({ ...atual, produto: e.target.value }))}
                  placeholder="Ex: ESPAÇADOR S25" />
              </label>
              <label>
                Quantidade de peças
                <input type="number" min="1" step="1" inputMode="numeric" value={interno.quantidade}
                  onChange={(e) => setInterno((atual) => ({ ...atual, quantidade: e.target.value }))}
                  placeholder="Ex: 500" />
              </label>
            </div>

            <div className="internal-save-controls">
              <button type="button" className="save-internal-button" onClick={salvarEtiquetaInterna}>
                Salvar etiqueta para reutilizar
              </button>
              {avisoInterno && <p className="internal-save-message" role="status">{avisoInterno}</p>}
            </div>

            <section className="saved-internal-section" aria-label="Etiquetas internas salvas">
              <button
                type="button"
                className="saved-internal-toggle"
                aria-expanded={salvasAbertas}
                aria-controls="saved-internal-content"
                onClick={() => setSalvasAbertas((abertas) => !abertas)}
              >
                <span>📁 Etiquetas salvas <span className="saved-internal-count">{etiquetasSalvas.length}</span></span>
                <span aria-hidden="true">{salvasAbertas ? "▲" : "▼"}</span>
              </button>

              {salvasAbertas && (
                <div id="saved-internal-content" className="saved-internal-content">
                  <label className="saved-internal-search-label" htmlFor="pesquisa-etiquetas">
                    Buscar produto ou quantidade
                    <input
                      id="pesquisa-etiquetas"
                      type="search"
                      value={buscaSalvas}
                      onChange={(e) => setBuscaSalvas(e.target.value)}
                      placeholder="Ex: espaçador ou 1000"
                    />
                  </label>
                  {etiquetasSalvas.length === 0 ? (
                    <p className="saved-internal-empty">Nenhuma etiqueta salva ainda.</p>
                  ) : (() => {
                    const termo = buscaSalvas.trim().toLocaleLowerCase("pt-BR");
                    const resultados = [...etiquetasSalvas]
                      .filter((item) =>
                        item.produto.toLocaleLowerCase("pt-BR").includes(termo) ||
                        String(item.quantidade).includes(termo) ||
                        Number(item.quantidade).toLocaleString("pt-BR").includes(termo)
                      )
                      .sort((a, b) =>
                        a.produto.localeCompare(b.produto, "pt-BR") ||
                        Number(a.quantidade) - Number(b.quantidade)
                      );
                    return resultados.length === 0 ? (
                      <p className="saved-internal-empty">Nenhuma etiqueta encontrada para essa busca.</p>
                    ) : (
                      <div className="saved-internal-list">
                        {resultados.map((item) => (
                          <div className="saved-internal-item" key={item.id}>
                            <div className="saved-internal-details">
                              <strong>{item.produto}</strong>
                              <span>{Number(item.quantidade).toLocaleString("pt-BR")} peças</span>
                            </div>
                            <div className="saved-internal-actions">
                              <button type="button" onClick={() => usarEtiquetaSalva(item)}>Usar</button>
                              <button type="button" className="saved-internal-delete"
                                onClick={() => excluirEtiquetaSalva(item)}
                                aria-label={`Excluir ${item.produto}, ${item.quantidade} peças`}>
                                Excluir
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    );
                  })()}
                  <p className="saved-internal-note">Salvas apenas neste navegador e dispositivo. A data impressa será a do dia.</p>
                </div>
              )}
            </section>

            <div className="internal-info">
              <span><strong>Data automática:</strong> {dataHoje()}</span>
              <span><strong>Formato:</strong> Zebra ZD220 · papel 100 × 150 mm (layout horizontal)</span>
              <span><strong>Responsável:</strong> espaço em branco para preencher à caneta</span>
            </div>

            <div className="preview">
              <p>Prévia da etiqueta interna</p>
              <div className="internal-label-preview">
                <div className="internal-product">{interno.produto.trim() || "NOME DO PRODUTO"}</div>
                <div className="internal-quantity-title">Quantidade</div>
                <div className="internal-quantity">{interno.quantidade ? `${Number(interno.quantidade).toLocaleString("pt-BR")} peças` : "— peças"}</div>
                <div className="internal-date">Data: {dataHoje()}</div>
                <div className="internal-responsible">Responsável: __________________</div>
                <div className="internal-company">
                  <strong>{EMPRESA.nome}</strong>
                  <span>{EMPRESA.telefones}</span>
                  <span>{EMPRESA.email}</span>
                </div>
              </div>
            </div>

            <div className="action-buttons">
              <button type="button" className="preview-button" onClick={() => criarPDFInterno(false)}>Visualizar etiqueta</button>
              <button type="button" className="generate-button" onClick={() => criarPDFInterno(true)}>Baixar PDF</button>
            </div>
            <button type="button" className="clear-button" onClick={limparInterno}>Limpar campos</button>
          </section>
        )}
      </section>
    </main>
  );
}

export default App;