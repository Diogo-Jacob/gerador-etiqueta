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
  const [formatoInterno, setFormatoInterno] = useState("100x150");
  const [modeloInterno, setModeloInterno] = useState("empresa"); // "empresa" ou "mercado-livre"
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
    formatoZebra: "100x150",
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
      formatoZebra: "100x150",
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

  // Evita que textos longos ultrapassem a área segura de impressão.
  function escreverCentralizado(doc, texto, centroX, y, larguraMaxima, fonteInicial, fonteMinima = 8) {
    doc.setFont("helvetica", "bold");
    let fonte = fonteInicial;
    doc.setFontSize(fonte);
    while (doc.getTextWidth(texto) > larguraMaxima && fonte > fonteMinima) {
      fonte -= 0.5;
      doc.setFontSize(fonte);
    }
    doc.text(texto, centroX, y, { align: "center" });
  }

  // PDF térmico: uma página por volume. Sem moldura externa, que poderia ser cortada
  // caso a impressora tenha um pequeno deslocamento de posicionamento.
  function criarPDFZebra(destinatario, nf, totalVolumes, formato = "100x150") {
    const compacto = formato === "100x50";
    const largura = 100;
    const altura = compacto ? 50 : 150;
    const doc = new jsPDF({ orientation: compacto ? "landscape" : "portrait", unit: "mm", format: [largura, altura] });
    const centro = largura / 2;

    for (let i = 1; i <= totalVolumes; i++) {
      if (i > 1) doc.addPage([largura, altura], compacto ? "landscape" : "portrait");
      doc.setFont("helvetica", "bold");

      if (compacto) {
        // Margem lateral de 6 mm e vertical de pelo menos 5 mm.
        let fonteNome = 13;
        let linhasNome = [];
        do {
          doc.setFontSize(fonteNome);
          linhasNome = doc.splitTextToSize(destinatario.toUpperCase(), 88);
          if (linhasNome.length <= 2) break;
          fonteNome -= 0.5;
        } while (fonteNome > 8);
        if (linhasNome.length > 2) {
          alert("O destinatário é muito longo para a etiqueta 100x50. Abrevie o nome ou use 100x150.");
          return null;
        }
        const yNome = linhasNome.length === 1 ? 12 : 9.5;
        doc.text(linhasNome, centro, yNome, { align: "center", lineHeightFactor: 1.05 });
        doc.setDrawColor(160);
        doc.setLineWidth(0.18);
        doc.line(7, 19, 93, 19);
        escreverCentralizado(doc, `NF/${formatarNF(nf)}`, centro, 29, 86, 20, 12);
        escreverCentralizado(doc, `VOLUME ${i}/${totalVolumes}`, centro, 42, 86, 20, 12);
      } else {
        // Modelo grande: toda a informação centralizada com 8 mm livres nas bordas.
        let fonteNome = 18;
        let linhasNome = [];
        do {
          doc.setFontSize(fonteNome);
          linhasNome = doc.splitTextToSize(destinatario.toUpperCase(), 84);
          if (linhasNome.length <= 3) break;
          fonteNome -= 0.5;
        } while (fonteNome > 9);
        if (linhasNome.length > 3) {
          alert("O nome do destinatário é muito longo. Abrevie antes de gerar a etiqueta.");
          return null;
        }
        const yNome = 30 - ((linhasNome.length - 1) * fonteNome * 0.35) / 2;
        doc.text(linhasNome, centro, yNome, { align: "center", lineHeightFactor: 1.05 });
        doc.setDrawColor(160);
        doc.setLineWidth(0.2);
        doc.line(9, 55, 91, 55);
        escreverCentralizado(doc, `NF/${formatarNF(nf)}`, centro, 76, 84, 26, 12);
        doc.line(9, 88, 91, 88);
        escreverCentralizado(doc, "VOLUME", centro, 108, 84, 20, 12);
        escreverCentralizado(doc, `${i}/${totalVolumes}`, centro, 131, 84, 39, 14);
      }
    }
    return doc;
  }

  // Etiqueta de produção: 150x100 (rolo 100x150 girado) ou 100x50.
  // O layout prioriza letras grandes, sem borda externa, com área segura de 4 mm.
  function criarPDFInterno(baixar = true) {
    const produto = interno.produto.trim();
    const quantidade = interno.quantidade.trim();
    if (!produto || !/^\d+$/.test(quantidade) || Number(quantidade) < 1 || !Number.isSafeInteger(Number(quantidade))) {
      alert("Informe o nome do produto e uma quantidade válida de peças.");
      return;
    }

    const compacto = formatoInterno === "100x50";
    const doc = new jsPDF({
      orientation: "landscape",
      unit: "mm",
      format: compacto ? [100, 50] : [150, 100],
    });
    const centro = compacto ? 50 : 75;
    const qtdTexto = `${Number(quantidade).toLocaleString("pt-BR")} peças`;

    // Escolhe a maior fonte que mantém o produto em até duas linhas.
    // Verifica também se a largura de cada linha cabe dentro da etiqueta.
    const larguraProduto = compacto ? 91 : 138;
    const fonteMinima = compacto ? 11 : 14;
    let fonteProduto = compacto ? 22 : 24;
    let linhasProduto = [];
    while (fonteProduto >= fonteMinima) {
      doc.setFont("helvetica", "bold");
      doc.setFontSize(fonteProduto);
      linhasProduto = doc.splitTextToSize(produto.toUpperCase(), larguraProduto);
      if (linhasProduto.length <= 2 && linhasProduto.every((linha) => doc.getTextWidth(linha) <= larguraProduto)) break;
      fonteProduto -= 0.5;
    }
    if (linhasProduto.length > 2 || linhasProduto.some((linha) => doc.getTextWidth(linha) > larguraProduto)) {
      alert("O nome do produto é muito longo para esse formato. Abrevie ou escolha 100x150.");
      return;
    }

    // Escreve uma linha sem ultrapassar a largura máxima disponível.
    function textoAjustado(texto, x, y, larguraMax, fonte, minimo, opcoes = {}) {
      doc.setFontSize(fonte);
      while (doc.getTextWidth(texto) > larguraMax && fonte > minimo) {
        fonte -= 0.5;
        doc.setFontSize(fonte);
      }
      doc.text(texto, x, y, opcoes);
    }

    doc.setTextColor(0);
    doc.setDrawColor(135);
    doc.setLineWidth(0.18);
    doc.setFont("helvetica", "bold");

    if (compacto) {
      // 100x50: praticamente toda a altura é utilizada; 4 mm de margem lateral.
      // O título fica perto da borda superior e maior do que no layout anterior.
      doc.setFontSize(fonteProduto);
      const yProduto = linhasProduto.length === 1 ? 13.1 : 7.5;
      doc.text(linhasProduto, centro, yProduto, {
        align: "center",
        lineHeightFactor: 1.02,
      });
      doc.line(4.5, 19.2, 95.5, 19.2);

      // Destaque da quantidade: texto maior e alinhado à direita.
      doc.setFont("helvetica", "normal");
      textoAjustado("Qtd:", 4.5, 29.3, 25, 11.5, 9.5);
      doc.setFont("helvetica", "bold");
      textoAjustado(qtdTexto, 95.5, 29.8, 65, 25, 12, { align: "right" });

      if (modeloInterno === "mercado-livre") {
        // Mercado Livre: somente produto, quantidade, data e responsável.
        doc.line(4.5, 34, 95.5, 34);
        doc.setFont("helvetica", "normal");
        textoAjustado("Responsável: __________________", 4.5, 41, 90, 11, 9);
        textoAjustado(`Data: ${dataHoje()}`, 4.5, 47.1, 90, 11, 9);
      } else {
        // Empresa: fontes ampliadas, sem moldura que poderia ser cortada.
        doc.setFont("helvetica", "normal");
        textoAjustado("Responsável: ______________", 4.5, 35.1, 56, 9.3, 8.5);
        textoAjustado(`Data: ${dataHoje()}`, 95.5, 35.1, 38, 9.3, 8.5, { align: "right" });
        doc.line(4.5, 37.2, 95.5, 37.2);

        doc.setFont("helvetica", "bold");
        textoAjustado(EMPRESA.nome, centro, 41.4, 91, 10.5, 8, { align: "center" });
        doc.setFont("helvetica", "normal");
        textoAjustado(EMPRESA.telefones, centro, 45.2, 91, 9.2, 7.5, { align: "center" });
        textoAjustado(EMPRESA.email, centro, 48.4, 91, 9.2, 7.5, { align: "center" });
      }
    } else {
      // 100x150 (layout na horizontal): mantém o tamanho geral, aumenta
      // apenas o bloco de identificação/contatos da empresa.
      const alturaLinha = fonteProduto * 0.4;
      const yProduto = 17 - ((linhasProduto.length - 1) * alturaLinha) / 2;
      doc.setFontSize(fonteProduto);
      doc.text(linhasProduto, centro, yProduto, { align: "center", lineHeightFactor: 1.1 });
      doc.line(8, 30, 142, 30);

      doc.setFont("helvetica", "normal");
      doc.setFontSize(13);
      doc.text("Quantidade:", 10, 44);
      doc.setFont("helvetica", "bold");
      textoAjustado(qtdTexto, 140, 44, 94, 23, 12, { align: "right" });

      if (modeloInterno === "mercado-livre") {
        doc.line(8, 55, 142, 55);
        doc.setFont("helvetica", "normal");
        doc.setFontSize(14);
        doc.text(`Data: ${dataHoje()}`, 10, 70);
        doc.text("Responsável: __________________", 10, 87);
      } else {
        doc.setFont("helvetica", "normal");
        doc.setFontSize(11.5);
        doc.text("Responsável: __________________", 10, 60);
        doc.text(`Data: ${dataHoje()}`, 140, 60, { align: "right" });
        doc.line(8, 67, 142, 67);

        doc.setFont("helvetica", "bold");
        textoAjustado(EMPRESA.nome, centro, 77, 136, 17, 11, { align: "center" });
        doc.setFont("helvetica", "normal");
        textoAjustado(EMPRESA.telefones, centro, 86, 136, 14.5, 10, { align: "center" });
        textoAjustado(EMPRESA.email, centro, 95, 136, 14.5, 10, { align: "center" });
      }
    }

    const nomeSeguro = produto.toLowerCase()
      .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 45);
    abrirOuBaixarPDF(doc, `etiqueta-v2-${modeloInterno === "mercado-livre" ? "mercado-livre" : "interna"}-${formatoInterno}-${nomeSeguro || "produto"}.pdf`, baixar);
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
      const docZebra = criarPDFZebra(destinatario, nf, totalVolumes, dados.formatoZebra);
      if (!docZebra) return;
      if (baixar) {
        docZebra.save(`etiquetas-zebra-${dados.formatoZebra}-nf-${formatarNF(nf)}.pdf`);
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
      <style>{`
        /* Prévia fiel à orientação horizontal dos PDFs internos. */
        .internal-label-preview.internal-v2 {
          width: 100%; max-width: 100%; box-sizing: border-box;
          padding: 10px 12px 8px; border: 1px solid #1f2937;
          display: flex; flex-direction: column; align-items: stretch;
          gap: 0; min-height: 0; overflow: hidden;
          background: #fff; text-align: center;
        }
        .internal-v2.size-150 { aspect-ratio: 3 / 2; }
        .internal-v2.size-50 { aspect-ratio: 2 / 1; padding: 6px 8px 4px; }
        .internal-v2 .internal-product {
          display: block; min-height: 0; font-size: clamp(20px, 5.2vw, 31px);
          font-weight: 900; line-height: 1.05; text-transform: uppercase;
          margin: 0 0 7px; padding: 0;
        }
        .internal-v2 .internal-quantity-title {
          width: 100%; border-top: 1px solid #64748b;
          padding-top: 5px; font-size: clamp(13px, 2.4vw, 16px);
          line-height: 1.1;
        }
        .internal-v2 .internal-quantity {
          font-size: clamp(24px, 6vw, 38px); font-weight: 900;
          line-height: 1.1; margin: 3px 0 7px;
        }
        .internal-v2 .internal-date,
        .internal-v2 .internal-responsible {
          align-self: flex-start; text-align: left;
          font-size: clamp(12px, 2.2vw, 15px);
          line-height: 1.3; white-space: normal; padding: 0; margin: 0 0 3px;
        }
        .internal-v2 .internal-company {
          margin-top: auto; padding-top: 4px; border-top: 1px solid #64748b;
          display: flex; flex-direction: column; gap: 2px; width: 100%;
          font-size: clamp(12px, 2.35vw, 15px); line-height: 1.15;
        }
        .internal-v2 .internal-company strong { font-size: 1.08em; }
        .internal-v2.size-50 .internal-product {
          font-size: clamp(17px, 4.5vw, 27px); margin-bottom: 3px;
        }
        .internal-v2.size-50 .internal-quantity-title {
          padding-top: 3px; font-size: clamp(11px, 2.2vw, 14px);
        }
        .internal-v2.size-50 .internal-quantity {
          font-size: clamp(19px, 5.2vw, 32px); margin: 1px 0 2px;
        }
        .internal-v2.size-50 .internal-date,
        .internal-v2.size-50 .internal-responsible {
          font-size: clamp(10px, 2vw, 13px); margin-bottom: 1px;
        }
        .internal-v2.size-50 .internal-company {
          font-size: clamp(8px, 1.8vw, 11px); gap: 0; padding-top: 2px;
        }
        .internal-v2.marketplace .internal-quantity { margin-bottom: auto; }
        @media (max-width: 440px) {
          .internal-v2.size-50 .internal-product { font-size: 16px; }
          .internal-v2.size-50 .internal-quantity { font-size: 21px; }
          .internal-v2.size-50 .internal-company { font-size: 8px; }
        }
      `}</style>
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
              ou nos formatos térmicos 100x150 e 100x50 mm.
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

          {dados.tipoImpressao === "zebra" && (
            <label>
              Tamanho da etiqueta Zebra
              <select value={dados.formatoZebra}
                onChange={(e) => atualizarCampo("formatoZebra", e.target.value)}>
                <option value="100x150">100 × 150 mm - maior</option>
                <option value="100x50">100 × 50 mm - compacta</option>
              </select>
            </label>
          )}

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
              <p className="subtitle">Preencha produto e quantidade. A data é automática e o responsável fica em branco para preencher à caneta.</p>
            </div>

            <div className="form">
              <div role="group" aria-label="Modelo da etiqueta interna">
                <span style={{ display: "block", fontSize: 14, fontWeight: 700, marginBottom: 8 }}>
                  Modelo da etiqueta
                </span>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 8 }}>
                  <button type="button" aria-pressed={modeloInterno === "empresa"}
                    onClick={() => setModeloInterno("empresa")}
                    style={{ padding: "12px 8px", borderRadius: 12, cursor: "pointer", fontWeight: 700,
                      border: `2px solid ${modeloInterno === "empresa" ? "#2563eb" : "#cbd5e1"}`,
                      background: modeloInterno === "empresa" ? "#eff6ff" : "#fff",
                      color: modeloInterno === "empresa" ? "#1d4ed8" : "#111827" }}>
                    🏭 Empresa
                  </button>
                  <button type="button" aria-pressed={modeloInterno === "mercado-livre"}
                    onClick={() => setModeloInterno("mercado-livre")}
                    style={{ padding: "12px 8px", borderRadius: 12, cursor: "pointer", fontWeight: 700,
                      border: `2px solid ${modeloInterno === "mercado-livre" ? "#2563eb" : "#cbd5e1"}`,
                      background: modeloInterno === "mercado-livre" ? "#eff6ff" : "#fff",
                      color: modeloInterno === "mercado-livre" ? "#1d4ed8" : "#111827" }}>
                    📦 Mercado Livre
                  </button>
                </div>
                <small style={{ display: "block", marginTop: 8, color: "#64748b", lineHeight: 1.4 }}>
                  {modeloInterno === "mercado-livre"
                    ? "Sem identificação ou contatos da empresa; mantém produto, quantidade, data e responsável."
                    : "Inclui nome e contatos da SD Plásticos."}
                </small>
              </div>
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

            <div className="form">
              <label>
                Tamanho da etiqueta Zebra
                <select value={formatoInterno} onChange={(e) => setFormatoInterno(e.target.value)}>
                  <option value="100x150">100 × 150 mm - maior (horizontal)</option>
                  <option value="100x50">100 × 50 mm - compacta (horizontal)</option>
                </select>
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
              <span><strong>Formato:</strong> Zebra ZD220 · papel {formatoInterno.replace("x", " × ")} mm (layout horizontal)</span>
              <span><strong>Modelo:</strong> {modeloInterno === "mercado-livre" ? "Mercado Livre (sem dados da empresa)" : "Empresa (com dados da SD)"}</span>
              <span><strong>Responsável:</strong> espaço em branco para preencher à caneta</span>
            </div>

            <div className="preview">
              <p>Prévia da etiqueta interna</p>
              <div className={`internal-label-preview internal-v2 ${formatoInterno === "100x50" ? "size-50" : "size-150"} ${modeloInterno === "mercado-livre" ? "marketplace" : ""}`}>
                <div className="internal-product">{interno.produto.trim() || "NOME DO PRODUTO"}</div>
                <div className="internal-quantity-title">Quantidade</div>
                <div className="internal-quantity">{interno.quantidade ? `${Number(interno.quantidade).toLocaleString("pt-BR")} peças` : "— peças"}</div>
                <div className="internal-date">Data: {dataHoje()}</div>
                <div className="internal-responsible">Responsável: __________________</div>
                {modeloInterno === "empresa" && (
                  <div className="internal-company">
                    <strong>{EMPRESA.nome}</strong>
                    <span>{EMPRESA.telefones}</span>
                    <span>{EMPRESA.email}</span>
                  </div>
                )}
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