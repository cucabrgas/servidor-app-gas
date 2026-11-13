const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: { origin: "*" },
    pingInterval: 10000,
    pingTimeout: 5000
});

app.use(express.static(path.join(__dirname, 'public')));

let transmissorAtual = null;

io.on('connection', (socket) => {
    if (transmissorAtual) {
        io.to(transmissorAtual).emit('pedir-tela', { para: socket.id });
    }

    socket.on('iniciou-tela', () => {
        transmissorAtual = socket.id;
        socket.broadcast.emit('solicitar-conexao');
    });

    socket.on('quero-assistir', () => {
        if (transmissorAtual && transmissorAtual !== socket.id) {
            io.to(transmissorAtual).emit('pedir-tela', { para: socket.id });
        }
    });

    socket.on('sinal-tela', (dados) => {
        if (dados.para) {
            io.to(dados.para).emit('sinal-tela', {
                de: socket.id,
                sinal: dados.sinal
            });
        }
    });

    socket.on('parou-tela', () => {
        if (transmissorAtual === socket.id) {
            transmissorAtual = null;
        }
        socket.broadcast.emit('parou-tela');
    });

    socket.on('disconnect', () => {
        if (transmissorAtual === socket.id) {
            transmissorAtual = null;
            socket.broadcast.emit('parou-tela');
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Servidor APP G.A.S oficial rodando na porta ${PORT}`);
});
