const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
    cors: {
        origin: "*"
    },
    pingInterval: 10000,
    pingTimeout: 5000
});

app.use(express.static(path.join(__dirname, "public")));

// IDs das pessoas que estão compartilhando a tela.
const transmissores = new Set();

function listarTransmissores() {
    return Array.from(transmissores);
}

function atualizarLista() {
    io.emit("lista-transmissores", listarTransmissores());
}

function solicitarTelasPara(espectadorId) {
    transmissores.forEach((transmissorId) => {
        // Não solicitar a própria transmissão.
        if (transmissorId === espectadorId) return;

        io.to(transmissorId).emit("pedir-tela", {
            para: espectadorId
        });
    });
}

function encerrarTransmissao(socket) {
    // Só anuncia o encerramento se a pessoa estava transmitindo.
    if (!transmissores.delete(socket.id)) return;

    socket.broadcast.emit("parou-tela", {
        de: socket.id
    });

    atualizarLista();

    console.log(`Transmissão encerrada: ${socket.id}`);
}

io.on("connection", (socket) => {
    console.log(`Participante conectado: ${socket.id}`);

    socket.emit("lista-transmissores", listarTransmissores());

    // O cliente solicita as telas com "quero-assistir"
    // depois de estabelecer a conexão.

    socket.on("iniciou-tela", () => {
        // Evita anunciar duas vezes a mesma transmissão.
        if (transmissores.has(socket.id)) return;

        transmissores.add(socket.id);

        console.log(`Transmissão iniciada: ${socket.id}`);

        atualizarLista();

        socket.broadcast.emit("solicitar-conexao", {
            de: socket.id
        });
    });

    socket.on("quero-assistir", (dados) => {
        // Com "de", solicita uma transmissão específica.
        const transmissorId = dados && dados.de;

        if (typeof transmissorId === "string") {
            if (
                transmissorId !== socket.id &&
                transmissores.has(transmissorId)
            ) {
                io.to(transmissorId).emit("pedir-tela", {
                    para: socket.id
                });
            }

            return;
        }

        // Sem "de", solicita todas as transmissões ativas.
        solicitarTelasPara(socket.id);
    });

    socket.on("sinal-tela", (dados) => {
        if (
            !dados ||
            typeof dados.para !== "string" ||
            !dados.sinal ||
            typeof dados.sinal !== "object"
        ) {
            return;
        }

        const destinatarioId = dados.para;

        if (destinatarioId === socket.id) return;

        if (!io.sockets.sockets.has(destinatarioId)) return;

        io.to(destinatarioId).emit("sinal-tela", {
            // A identidade vem da conexão, não dos dados enviados.
            de: socket.id,
            sinal: dados.sinal
        });
    });

    socket.on("parou-tela", () => {
        encerrarTransmissao(socket);
    });

    socket.on("disconnect", () => {
        encerrarTransmissao(socket);

        socket.broadcast.emit("participante-saiu", {
            de: socket.id
        });

        console.log(`Participante desconectado: ${socket.id}`);
    });
});

const PORT = process.env.PORT || 3000;

server.listen(PORT, () => {
    console.log(
        `Servidor APP G.A.S oficial rodando na porta ${PORT}`
    );
});
