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

        resposta({ ok: true, nickname });

        socket.emit("historico-chat", historicoChat);
        atualizarListas();
        aviso(`${nickname} entrou na sala.`);
    });

    socket.on("mensagem-chat", (dados, responder) => {
        const pessoa = participantes.get(socket.id);
        if (!pessoa) return;

        const texto = String(dados?.texto || "")
            .trim()
            .slice(0, 500);

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

const PORT = process.env.PORT || 3000;

server.listen(PORT, () => {
    console.log(`Servidor APP G.A.S oficial rodando na porta ${PORT}`);
});
