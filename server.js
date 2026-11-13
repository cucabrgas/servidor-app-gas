const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");
const multer = require("multer");
const sharp = require("sharp");
const { randomUUID } = require("crypto");

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
    cors: { origin: "*" },
    pingInterval: 10000,
    pingTimeout: 5000
});

app.use(express.static(path.join(__dirname, "public")));

const participantes = new Map();
const transmissores = new Set();
const historicoChat = [];

const LIMITE_IMAGEM = 10 * 1024 * 1024;
const LIMITE_TOTAL_IMAGENS = 64 * 1024 * 1024;
const TEMPO_IMAGEM = 60 * 60 * 1000;
const LIMITE_PIXELS = 24000000;

const imagensChat = new Map();

let bytesImagens = 0;
let uploadsAtivos = 0;

sharp.cache(false);
sharp.concurrency(1);

function listaParticipantes() {
    return [...participantes.entries()].map(([id, pessoa]) => ({
        id,
        nickname: pessoa.nickname,
        compartilhando: transmissores.has(id)
    }));
}

function listaTransmissores() {
    return [...transmissores].map((id) => ({
        id,
        nickname: participantes.get(id)?.nickname || "Participante"
    }));
}

function atualizarListas() {
    io.emit("lista-participantes", listaParticipantes());
    io.emit("lista-transmissores", listaTransmissores());
}

function aviso(texto) {
    io.emit("aviso-chat", {
        texto,
        horario: Date.now()
    });
}

function guardarMensagem(mensagem) {
    historicoChat.push(mensagem);

    if (historicoChat.length > 100) {
        historicoChat.shift();
    }

    io.emit("mensagem-chat", mensagem);
}

function encerrarTransmissao(socket) {
    if (!transmissores.delete(socket.id)) return;

    socket.broadcast.emit("parou-tela", {
        de: socket.id
    });

    atualizarListas();
}

function pedirTela(transmissor, espectador) {
    if (
        transmissor === espectador ||
        !transmissores.has(transmissor) ||
        !participantes.has(espectador)
    ) {
        return;
    }

    io.to(transmissor).emit("pedir-tela", {
        para: espectador
    });
}

io.on("connection", (socket) => {
    socket.on("registrar", (dados, responder) => {
        const resposta = (conteudo) => {
            if (typeof responder === "function") {
                responder(conteudo);
            }
        };

        if (participantes.has(socket.id)) {
            resposta({
                ok: true,
                nickname: participantes.get(socket.id).nickname
            });
            return;
        }

        const nickname = String(dados?.nickname || "")
            .replace(/[\u0000-\u001f\u007f]/g, "")
            .trim()
            .slice(0, 24);

        if (!nickname) {
            resposta({
                ok: false,
                erro: "Digite seu nickname."
            });
            return;
        }

        const repetido = [...participantes.values()].some(
            (pessoa) =>
                pessoa.nickname.toLocaleLowerCase("pt-BR") ===
                nickname.toLocaleLowerCase("pt-BR")
        );

        if (repetido) {
            resposta({
                ok: false,
                erro: "Esse nickname já está em uso."
            });
            return;
        }

        participantes.set(socket.id, {
            nickname,
            ultimaMensagem: 0
        });

        socket.data.uploadToken = randomUUID();

        resposta({ ok: true, nickname });

        socket.emit("historico-chat", historicoChat);
        atualizarListas();
        aviso(`${nickname} entrou na sala.`);
    });

    socket.on("solicitar-upload-token", (responder) => {
        if (typeof responder !== "function") return;

        if (!participantes.has(socket.id)) {
            responder({
                ok: false,
                erro: "Entre na sala antes de enviar imagens."
            });
            return;
        }

        responder({
            ok: true,
            token: socket.data.uploadToken
        });
    });

    socket.on("mensagem-chat", (dados, responder) => {
        const resposta = (conteudo) => {
            if (typeof responder === "function") {
                responder(conteudo);
            }
        };

        const pessoa = participantes.get(socket.id);

        if (!pessoa) {
            resposta({
                ok: false,
                erro: "Entre na sala primeiro."
            });
            return;
        }

        const texto = String(dados?.texto || "")
            .trim()
            .slice(0, 500);

        if (!texto) {
            resposta({
                ok: false,
                erro: "Digite uma mensagem."
            });
            return;
        }

        const agora = Date.now();

        if (agora - pessoa.ultimaMensagem < 800) {
            resposta({
                ok: false,
                erro: "Aguarde um instante entre as mensagens."
            });
            return;
        }

        pessoa.ultimaMensagem = agora;

        guardarMensagem({
            de: socket.id,
            nickname: pessoa.nickname,
            texto,
            horario: agora
        });

        resposta({ ok: true });
    });

    socket.on("iniciou-tela", () => {
        if (!participantes.has(socket.id)) return;
        if (transmissores.has(socket.id)) return;

        transmissores.add(socket.id);
        atualizarListas();

        socket.broadcast.emit("nova-transmissao", {
            id: socket.id,
            nickname: participantes.get(socket.id).nickname
        });
    });

    socket.on("quero-assistir", (dados) => {
        if (!participantes.has(socket.id)) return;

        if (typeof dados?.de === "string") {
            pedirTela(dados.de, socket.id);
            return;
        }

        transmissores.forEach((id) => {
            pedirTela(id, socket.id);
        });
    });

    socket.on("sinal-tela", (dados) => {
        if (!participantes.has(socket.id)) return;
        if (!dados || typeof dados.para !== "string") return;
        if (typeof dados.transmissor !== "string") return;
        if (!dados.sinal || typeof dados.sinal !== "object") return;
        if (dados.para === socket.id) return;
        if (!participantes.has(dados.para)) return;
        if (!transmissores.has(dados.transmissor)) return;

        if (
            socket.id !== dados.transmissor &&
            dados.para !== dados.transmissor
        ) {
            return;
        }

        io.to(dados.para).emit("sinal-tela", {
            de: socket.id,
            transmissor: dados.transmissor,
            nickname: participantes.get(dados.transmissor).nickname,
            sinal: dados.sinal
        });
    });

    socket.on("parou-tela", () => {
        encerrarTransmissao(socket);
    });

    socket.on("disconnect", () => {
        const pessoa = participantes.get(socket.id);

        encerrarTransmissao(socket);
        participantes.delete(socket.id);

        socket.broadcast.emit("participante-saiu", {
            de: socket.id
        });

        if (pessoa) {
            atualizarListas();
            aviso(`${pessoa.nickname} saiu da sala.`);
        }
    });
});

function removerImagem(id) {
    const imagem = imagensChat.get(id);
    if (!imagem) return;

    bytesImagens -= imagem.buffer.length;
    imagensChat.delete(id);
}

function limparImagensExpiradas() {
    const agora = Date.now();

    for (const [id, imagem] of imagensChat) {
        if (agora >= imagem.expiraEm) {
            removerImagem(id);
        }
    }
}

setInterval(limparImagensExpiradas, 60000).unref();

function reservarEspacoImagem(tamanho) {
    limparImagensExpiradas();

    while (
        bytesImagens + tamanho > LIMITE_TOTAL_IMAGENS &&
        imagensChat.size > 0
    ) {
        removerImagem(imagensChat.keys().next().value);
    }
}

const receberImagem = multer({
    storage: multer.memoryStorage(),
    limits: {
        fileSize: LIMITE_IMAGEM,
        files: 1,
        fields: 0,
        parts: 1,
        headerPairs: 100
    }
}).single("imagem");

function autorizarUpload(req, res, next) {
    const token = req.get("X-Upload-Token");

    if (!token) {
        return res.status(401).json({
            erro: "Entre na sala antes de enviar."
        });
    }

    let conexao = null;

    for (const socket of io.sockets.sockets.values()) {
        if (
            socket.data.uploadToken === token &&
            participantes.has(socket.id)
        ) {
            conexao = socket;
            break;
        }
    }

    if (!conexao) {
        return res.status(401).json({
            erro: "Sua conexão expirou. Entre novamente."
        });
    }

    const agora = Date.now();

    if (agora - (conexao.data.ultimoUpload || 0) < 3000) {
        return res.status(429).json({
            erro: "Aguarde 3 segundos entre os envios."
        });
    }

    if (uploadsAtivos >= 1) {
        return res.status(503).json({
            erro: "Outro envio está em andamento. Tente novamente."
        });
    }

    conexao.data.ultimoUpload = agora;
    req.socketUpload = conexao;

    uploadsAtivos++;

    let liberado = false;

    req.liberarUpload = () => {
        if (liberado) return;
        liberado = true;
        uploadsAtivos--;
    };

    next();
}

app.post("/api/imagens", autorizarUpload, (req, res) => {
    // Libera a vaga caso o cliente interrompa o envio do corpo.
    req.once("aborted", req.liberarUpload);

    receberImagem(req, res, async (erroUpload) => {
        try {
            if (erroUpload) {
                const excedeu = erroUpload.code === "LIMIT_FILE_SIZE";

                return res.status(excedeu ? 413 : 400).json({
                    erro: excedeu
                        ? "A imagem ultrapassa o limite de 10 MB."
                        : "Envie somente uma imagem por vez."
                });
            }

            if (!req.file) {
                return res.status(400).json({
                    erro: "Selecione uma imagem."
                });
            }

            const entrada = sharp(req.file.buffer, {
                failOn: "warning",
                limitInputPixels: LIMITE_PIXELS,
                animated: false
            });

            const metadata = await entrada.metadata();

            if (!["jpeg", "png", "webp"].includes(metadata.format)) {
                return res.status(400).json({
                    erro: "Somente JPG, PNG e WebP são permitidos."
                });
            }

            if (
                !metadata.width ||
                !metadata.height ||
                metadata.width * metadata.height > LIMITE_PIXELS
            ) {
                return res.status(400).json({
                    erro: "Limite de dimensões: 24 megapixels."
                });
            }

            if ((metadata.pages || 1) > 1) {
                return res.status(400).json({
                    erro: "Imagens animadas não são permitidas."
                });
            }

            const buffer = await entrada
                .rotate()
                .webp({ quality: 90 })
                .toBuffer();

            if (buffer.length > LIMITE_IMAGEM) {
                return res.status(413).json({
                    erro: "A imagem processada excedeu 10 MB."
                });
            }

            const socket = req.socketUpload;
            const pessoa = participantes.get(socket.id);

            if (!pessoa || !socket.connected) {
                return res.status(401).json({
                    erro: "Você saiu da sala durante o envio."
                });
            }

            if (res.destroyed) return;

            const id = randomUUID();
            const agora = Date.now();

            reservarEspacoImagem(buffer.length);

            imagensChat.set(id, {
                buffer,
                expiraEm: agora + TEMPO_IMAGEM
            });

            bytesImagens += buffer.length;

            guardarMensagem({
                de: socket.id,
                nickname: pessoa.nickname,
                texto: "",
                tipo: "imagem",
                imagem: {
                    url: `/api/imagens/${id}`,
                    nome: "imagem.webp",
                    tamanho: buffer.length
                },
                horario: agora
            });

            res.json({ ok: true });
        } catch (erro) {
            console.error("Erro na imagem:", erro.message);

            if (!res.headersSent && !res.destroyed) {
                res.status(400).json({
                    erro: "Imagem inválida, danificada ou não suportada."
                });
            }
        } finally {
            req.liberarUpload();
        }
    });
});

app.get("/api/imagens/:id", (req, res) => {
    limparImagensExpiradas();

    const imagem = imagensChat.get(req.params.id);

    if (!imagem) {
        return res.status(404).send(
            "Imagem expirada ou indisponível."
        );
    }

    res.set({
        "Content-Type": "image/webp",
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "no-store",
        "Content-Disposition": 'inline; filename="imagem.webp"'
    });

    res.send(imagem.buffer);
});

const PORT = process.env.PORT || 3000;

server.listen(PORT, () => {
    console.log(`Servidor APP G.A.S oficial rodando na porta ${PORT}`);
});
