const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");

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
        const responderSePossivel = (resposta) => {
            if (typeof responder === "function") {
                responder(resposta);
            }
        };

        // O nickname não é alterado durante a mesma conexão.
        if (participantes.has(socket.id)) {
            return responderSePossivel({
                ok: true,
                nickname: participantes.get(socket.id).nickname
            });
        }

        const nickname = String(dados?.nickname || "")
            .replace(/[\u0000-\u001f\u007f]/g, "")
            .trim()
            .slice(0, 24);

        if (!nickname) {
            return responderSePossivel({
                ok: false,
                erro: "Digite seu nickname."
            });
        }

        const repetido = [...participantes.values()].some(
            (pessoa) =>
                pessoa.nickname.toLocaleLowerCase("pt-BR") ===
                nickname.toLocaleLowerCase("pt-BR")
        );

        if (repetido) {
            return responderSePossivel({
                ok: false,
                erro: "Esse nickname já está em uso."
            });
        }

        participantes.set(socket.id, {
            nickname,
            ultimaMensagem: 0
        });

        responderSePossivel({ ok: true, nickname });

        socket.emit("historico-chat", historicoChat);
        atualizarListas();
        aviso(`${nickname} entrou na sala.`);
    });

    socket.on("mensagem-chat", (dados, responder) => {
        const pessoa = participantes.get(socket.id);
        if (!pessoa) return;

        const texto = String(dados?.texto || "").trim().slice(0, 500);
        if (!texto) return;

        const agora = Date.now();

        if (agora - pessoa.ultimaMensagem < 800) {
            if (typeof responder === "function") {
                responder({
                    ok: false,
                    erro: "Aguarde um instante entre as mensagens."
                });
            }
            return;
        }

        pessoa.ultimaMensagem = agora;

        const mensagem = {
            de: socket.id,
            nickname: pessoa.nickname,
            texto,
            horario: agora
        };

        historicoChat.push(mensagem);

        if (historicoChat.length > 100) {
            historicoChat.shift();
        }

        io.emit("mensagem-chat", mensagem);

        if (typeof responder === "function") {
            responder({ ok: true });
        }
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
        } else {
            transmissores.forEach((id) => pedirTela(id, socket.id));
        }
    });

    socket.on("sinal-tela", (dados) => {
        if (!participantes.has(socket.id)) return;
        if (!dados || typeof dados.para !== "string") return;
        if (typeof dados.transmissor !== "string") return;
        if (!dados.sinal || typeof dados.sinal !== "object") return;
        if (dados.para
