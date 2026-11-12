const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: { origin: "*" }
});

app.use(express.static(path.join(__dirname, 'public')));

// Guarda os operadores conectados { socketId: nome }
const operadoresOnline = {};

io.on('connection', (socket) => {
    socket.on('entrar-sala', (nome) => {
        socket.nome = nome || 'Operador';
        operadoresOnline[socket.id] = socket.nome;

        io.emit('chat-msg', { usuario: 'Sistema', texto: `${socket.nome} entrou na sala.` });
        io.emit('lista-operadores', operadoresOnline);

        socket.broadcast.emit('novo-usuario-voz', { id: socket.id, nome: socket.nome });
    });

    socket.on('chat-msg', (texto) => {
        io.emit('chat-msg', { usuario: socket.nome, texto });
    });

    socket.on('sinal-voz', (dados) => {
        io.to(dados.para).emit('sinal-voz', {
            de: socket.id,
            sinal: dados.sinal,
            nome: socket.nome
        });
    });

    socket.on('sinal-tela', (dados) => {
        socket.broadcast.emit('sinal-tela', {
            remetente: socket.id,
            sinal: dados.sinal,
            nome: socket.nome
        });
    });

    socket.on('parou-tela', () => {
        socket.broadcast.emit('parou-tela');
    });

    socket.on('disconnect', () => {
        if (socket.nome) {
            delete operadoresOnline[socket.id];
            io.emit('chat-msg', { usuario: 'Sistema', texto: `${socket.nome} saiu da sala.` });
            io.emit('lista-operadores', operadoresOnline);
            socket.broadcast.emit('usuario-saiu-voz', socket.id);
        }
    });
});

const PORTA = process.env.PORT || 3000;
server.listen(PORTA, () => {
    console.log(`Servidor APP G.A.S oficial rodando na porta ${PORTA}`);
});
