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

function dadosTransmissores() {
    return [...transmissores].map((id) => ({
        id,
        nickname: participantes.get(id) || "Participante"
    }));
}

function atualizarLista() {
    io.emit("lista-transmissores", dadosTransmissores());
}

function pedirTela(transmissorId, espectadorId) {
    if (
        transmissorId === espectadorId ||
        !transmissores.has(transmissorId) ||
        !participantes.has(espectadorId)
    ) {
        return;
    }

    io.to(transmissorId).emit("pedir-tela", {
        para: espectadorId
    });
}

function encerrarTransmissao(socket) {
    if (!transmissores.delete(socket.id)) return;

    socket.broadcast.emit("parou-tela", {
        de: socket.id
    });

    atualizarLista();
}

io.on("connection", (socket) => {
    socket.on("registrar", (dados, responder) => {
        const nickname = String(dados?.nickname || "")
            .replace(/[\u0000-\u001f\u007f]/g, "")
            .trim()
            .slice(0, 24);

        if (!nickname) {
            if (typeof responder === "function") {
                responder({
                    ok: false,
                    erro: "Informe um nickname."
                });
            }
            return;
        }

        participantes.set(socket.id, nickname);

        if (typeof responder === "function") {
            responder({
                ok: true,
                id: socket.id,
                nickname
            });
        }

        socket.emit("lista-transmissores", dadosTransmissores());
        atualizarLista();
    });

    socket.on("iniciou-tela", () => {
        if (!participantes.has(socket.id)) return;
        if (transmissores.has(socket.id)) return;

        transmissores.add(socket.id);
        atualizarLista();

        socket.broadcast.emit("nova-transmissao", {
            id: socket.id,
            nickname: participantes.get(socket.id)
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

        const destino = dados.para;
        const transmissor = dados.transmissor;

        if (destino === socket.id) return;
        if (!participantes.has(destino)) return;
        if (!transmissores.has(transmissor)) return;

        // A sinalização deve envolver o dono da transmissão.
        if (
            socket.id !== transmissor &&
            destino !== transmissor
        ) {
            return;
        }

        io.to(destino).emit("sinal-tela", {
            de: socket.id,
            transmissor,
            nickname: participantes.get(transmissor),
            sinal: dados.sinal
        });
    });

    socket.on("parou-tela", () => {
        encerrarTransmissao(socket);
    });

    socket.on("disconnect", () => {
        encerrarTransmissao(socket);
        participantes.delete(socket.id);

        socket.broadcast.emit("participante-saiu", {
            de: socket.id
        });
    });
});

const PORT = process.env.PORT || 3000;

server.listen(PORT, () => {
    console.log(`APP G.A.S rodando na porta ${PORT}`);
});
