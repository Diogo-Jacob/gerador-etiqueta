import { useRef, useState } from "react";
import { jsPDF } from "jspdf";
import * as pdfjsLib from "pdfjs-dist";
import pdfjsWorker from "pdfjs-dist/build/pdf.worker.mjs?url";
import Tesseract from "tesseract.js";
import "./App.css";

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorker;

function App() {
  const inputRef = useRef(null);

  const [arquivo, setArquivo] = useState(null);
  const [status, setStatus] = useState("");
  const [dados, setDados] = useState({
    destinatario: "",
    nf: "",
    volumes: "",
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

  function criarPDFEtiquetas(baixar = true) {
    const destinatario = dados.destinatario.trim();
    const nf = dados.nf.trim();
    const totalVolumes = Number(dados.volumes);
    const etiquetasPorFolha = Number(dados.etiquetasPorFolha);

    if (!destinatario || !nf || !totalVolumes || totalVolumes < 1) {
      alert("Preencha destinatário, NF e quantidade de volumes.");
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
        <div className="header">
          <div>
            <p className="tag">Sistema simples</p>
            <h1>Gerador de Etiquetas</h1>
            <p className="subtitle">
              Anexe uma nota fiscal, confira os dados e gere etiquetas em folha
              A4.
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
      </section>
    </main>
  );
}

export default App;