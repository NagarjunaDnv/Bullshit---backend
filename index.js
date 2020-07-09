var express=require('express');
var cors = require('cors')
var app=express();
app.use(cors());
var server=require('http').createServer(app);
var socketio=require('socket.io');
var io=socketio().listen(server);


const cards=require('./assets/cards.json');

var rooms={};
var authRooms={};
var cardsDetails={};
var currentTurnDetails={};
var currentStackDetails={};
var currentDeclaration={};
var previouslyRevealedCards={};

io.on('connection',(socket)=>{
    console.log('A new connection has been established with' + socket.id);
    socket.on('disconnect',()=>{
        console.log('Client disconnected', socket.id);
        updateOnlineStatus(socket.id,socket.roomId);
    })

    socket.on('waitingRoom',(req, callback)=>{
        const userName= req['name'];
        const roomId= req['roomId'];
        const uid= req['uid'];
        if(authRooms[uid]){
            return callback({
                success: false,
                message: 'You are already in a game.'
            });
        }
        if(rooms[roomId]){
            const roomLength=rooms[roomId]['players'].length;
            if(!rooms[roomId]['isOver'] && roomLength<4){
                joinRoom(socket, roomId, userName, uid, rooms[roomId]['bulletLimit']);
                callback({
                    success: true,
                    message: 'You have successfully joined the group',
                    playerIndex: roomLength
                });
                if(roomLength===3){
                    rooms[roomId]['isFull']=true;
                }
            }
            else{
                callback({
                    success: false,
                    message:'Room is full'
                });
            }
        }
        else{
            return callback({
                success: false,
                message: 'Room Id not found'
            })
        }
    })

    socket.on('createRoom',(req,callback)=>{
        const userName= req['name'];
        const roomId= req['roomId'];
        const uid= req['uid'];
        const bulletLimit= req['bulletLimit'];
        console.log(bulletLimit);
        if(authRooms[uid]){
            return callback({
                success: false,
                message: 'You are already in a game.'
            });
        }
        if(rooms[roomId]){
            return callback({
                success: false,
                message: 'Room Id is already taken. Cannot create room'
            });
        }
        const room={
            id: roomId,
            by: userName,
            bulletLimit: bulletLimit,
            players: [],
            isOver: false
        }
        rooms[roomId]=room;
        joinRoom(socket, roomId, userName, uid, bulletLimit);
        return callback({
            success: true,
            message: 'Room is successfully created',
            playerIndex: 0
        });
    })

    socket.on('init',(req,callback)=>{
        const uid=req.uid;
        if(authRooms[uid]){
            const roomId=authRooms[uid];
            const index= rooms[roomId]['players'].findIndex(value=>value['uid']===uid);
            rooms[roomId]['players'][index]['socketId']= socket.id;
            rooms[roomId]['players'][index]['online']= true;
            socket.join(roomId,()=>{
                io.in(roomId).emit('players', rooms[roomId]);
                socket.roomId= roomId;
                if(cardsDetails[uid]){
                    io.to(socket.id).emit('initialCards', cardsDetails[uid]);
                }
                if(currentTurnDetails[roomId]){
                    io.to(socket.id).emit('turn',currentTurnDetails[roomId]);
                }
                if(currentStackDetails[roomId]){
                    io.to(socket.id).emit('currentStackDetailCount',currentStackDetails[roomId]['wholeStack'].length);
                }
                if(currentDeclaration[roomId]){
                    io.to(socket.id).emit('declarations',currentDeclaration[roomId]);
                }
                if(previouslyRevealedCards[roomId]){
                    io.in(socket.id).emit('revealDeclaredCards',previouslyRevealedCards[roomId]);
                }
            })
            callback(
                {
                    inGame: true,
                    playerIndex: index
                }
            );
        }
        else{
            callback({
                inGame: false
            })
        }
    })

    socket.on('declare',(reqBody)=>{
        const roomId= reqBody['roomId'];
        const uid= reqBody['declaredBy']['id'];
        currentStackDetails[roomId]['justDeclared']=reqBody['declaredCardsActual'];
        currentStackDetails[roomId]['wholeStack']= currentStackDetails[roomId]['wholeStack'].concat(reqBody['declaredCardsActual']);
        socket.broadcast.to(roomId).emit('currentStackDetailCount',currentStackDetails[roomId]['wholeStack'].length);
        currentDeclaration[roomId]= {
            declaredBy: reqBody.declaredBy,
            value: reqBody.value,
            count: reqBody.count
        };
        socket.broadcast.to(roomId).emit('declarations',currentDeclaration[roomId]);
        const index= rooms[roomId]['players'].findIndex(value=>value['uid']===uid);
        rooms[roomId]['players'][index]['count']-=reqBody.count;
        socket.broadcast.to(roomId).emit('players',rooms[roomId]);
        currentTurnDetails[roomId]={
            uid: reqBody['nextUID'],
            value: reqBody['nextValue']
        }
        socket.broadcast.to(roomId).emit('turn',currentTurnDetails[roomId]);
    })

    socket.on('bullshit',(reqBody,callback)=>{
        const roomId= reqBody.roomId;
        const fromUID= reqBody['from']['id'];
        const toUID= reqBody['to']['id'];
        const supposedValue= reqBody['previousValue'];
        const currentValue= reqBody['currentValue'];
        const count= reqBody['count'];
        const fromIndex= rooms[roomId]['players'].findIndex(value=>value['uid']===fromUID);
        const toIndex= rooms[roomId]['players'].findIndex(value=>value['uid']===toUID);

        io.in(roomId).emit('bullshitClicks',reqBody);
        io.in(roomId).emit('revealDeclaredCards',currentStackDetails[roomId]['justDeclared']);
        io.in(roomId).emit('declarations',null);

        previouslyRevealedCards[roomId]= currentStackDetails[roomId]['justDeclared'];
        let isLiar=false;
        for(let i=0;i<count;i++){
            if(currentStackDetails[roomId]['justDeclared'][i]['value']!=supposedValue){ 
               isLiar=true;
               break;
            }
        }
        if(isLiar){
            const stack= currentStackDetails[roomId]['wholeStack'];
            const toSocketId= rooms[roomId]['players'][toIndex]['socketId'];
            cardsDetails[toUID]=cardsDetails[toUID].concat(stack);
            rooms[roomId]['players'][toIndex]['count']=cardsDetails[toUID].length;
            currentStackDetails[roomId]['wholeStack']=[];
            io.in(roomId).emit('currentStackDetailCount',null);
            currentDeclaration[roomId]=null;
            currentTurnDetails[roomId]={
                uid: fromUID,
                value: supposedValue
            }
            const body={
                isLiar: isLiar,
                text: `Yayyy!!! ${reqBody['to']['name']} is a liar`,
                id: toUID
            }
            setTimeout(()=>{
                io.to(toSocketId).emit('initialCards',cardsDetails[toUID]);
                io.in(roomId).emit('players',rooms[roomId]);
                io.in(roomId).emit('turn',currentTurnDetails[roomId]);
                callback(body);
                socket.broadcast.to(roomId).emit('liarToasts',body);
            },300)
        }
        else{
            const stack= currentStackDetails[roomId]['wholeStack'];
            const fromSocketId= rooms[roomId]['players'][fromIndex]['socketId'];
            const toSocketId= rooms[roomId]['players'][toIndex]['socketId'];
            cardsDetails[fromUID]=cardsDetails[fromUID].concat(stack);
            rooms[roomId]['players'][fromIndex]['count']=cardsDetails[fromUID].length;
            currentStackDetails[roomId]['wholeStack']=[];
            io.in(roomId).emit('currentStackDetailCount',null);
            currentDeclaration[roomId]=null;
            currentTurnDetails[roomId]={
                uid: reqBody['nextUID'],
                value: currentValue
            }
            const body= {
                isLiar: isLiar,
                text: `Oops!!! ${reqBody['to']['name']} is not a liar`,
                id: toUID
            }
            rooms[roomId]['players'][fromIndex]['bulletCount']-=1;

            setTimeout(()=>{
                io.to(fromSocketId).emit('initialCards',cardsDetails[fromUID]);
                socket.broadcast.to(roomId).emit('players',rooms[roomId]);
                io.in(roomId).emit('turn',currentTurnDetails[roomId]);
                callback(body);
                socket.broadcast.to(roomId).emit('liarToasts',body);
                if(rooms[roomId]['bulletLimit']!=-1){
                    io.in(roomId).emit('players',rooms[roomId]);
                }
                if(cardsDetails[toUID].length==0){
                    const winnerResponse1={
                        text: 'You won!'
                    }
                    io.to(toSocketId).emit('win',winnerResponse1);
                    const winnerResponse2={
                        text: `${reqBody['to']['name']} won!`
                    }
                    io.in(roomId).emit('win',winnerResponse2);
                    deleteRoom(roomId);
                }
            },300)
        }
    })
    socket.on('userCardDetails',(reqBody)=>{
        const uid=reqBody['uid'];
        const userCards=reqBody['cards'];
        cardsDetails[uid]=userCards;
    })
    socket.on('winnerFromClient',(reqBody)=>{
        const roomId= reqBody['roomId'];
        const winnerIndex= reqBody['winnerIndex'];
        const clientIndex= reqBody['clientIndex'];
        const text=reqBody['text'];
        const winnerSocketId=rooms[roomId]['players'][winnerIndex]['socketId']
        const winnerResponse1={
            text: 'You won!'
        }
        const winnerResponse2={
            text: text
        }
        io.to(winnerSocketId).emit('win',winnerResponse1);
        for(let i=0;i<4;i++){
            if(i!=winnerIndex && i!=clientIndex){
                const sid= rooms[roomId]['players'][i]['socketId'];
                io.to(sid).emit('win',winnerResponse2);
            }
        }
        deleteRoom(roomId);
    })
})

function joinRoom(socket,roomId, userName, uid, bulletLimit){
    const player={
        name: userName,
        socketId: socket.id,
        online: true,
        uid: uid,
        count: 13,
        bulletCount: bulletLimit
    }
    rooms[roomId].players.push(player);
    socket.join(roomId,()=>{
        socket.roomId = roomId;
        authRooms[uid] = roomId;
        io.in(roomId).emit('players', rooms[roomId]);
        if(rooms[roomId].players.length==4){
            distributeCards(roomId)
        }
    })
}

function deleteRoom(roomId){
    const room=JSON.parse(JSON.stringify(rooms[roomId]));
    rooms[roomId]['isOver']= true;
    const players= room['players'];
    delete currentTurnDetails[roomId];
    delete currentStackDetails[roomId];
    delete currentDeclaration[roomId];
    delete previouslyRevealedCards[roomId];
    for(let i=0;i<4;i++){
        const uid= players[i]['uid'];
        const socketId= players[i]['socketId'];
        io.sockets.sockets[socketId].leave(roomId);
        io.sockets.sockets[socketId]['roomId']= null;
        delete authRooms[uid];
        delete cardsDetails[uid];
    }
    delete rooms[roomId];
}
// 0 12  --> 13 25 --> 26 38 --> 39 51

function distributeCards(roomId){
    const shuffledCards= shuffle(cards);
    const indices=[
        {
            start: 0,
            end: 13
        },
        {
            start: 13,
            end: 26
        },
        {
            start: 26,
            end: 39
        },
        {
            start: 39,
            end: 52
        }
    ]
    for(let i=0;i<4;i++){
        const socketId=rooms[roomId]['players'][i]['socketId'];
        const userUID=rooms[roomId]['players'][i]['uid'];
        cardsDetails[userUID] = shuffledCards.slice(indices[i]['start'],indices[i]['end']);        
        io.to(socketId).emit('initialCards', cardsDetails[userUID]);
    }
    currentTurnDetails[roomId]={
        uid: rooms[roomId]['players'][0]['uid'],
        value: 'A'
    }
    currentStackDetails[roomId]={wholeStack:[]};
    io.in(roomId).emit('turn',currentTurnDetails[roomId]);
    io.in(roomId).emit('currentStackDetailCount',currentStackDetails[roomId]['wholeStack'].length);
}
function updateOnlineStatus(id,roomId){
    if(roomId && rooms[roomId]){
        const playerIndex=rooms[roomId].players.findIndex((player)=>player.socketId==id);
        console.log(playerIndex);
        rooms[roomId]['players'][playerIndex]['online']=false;
        io.in(roomId).emit('players', rooms[roomId]);
    }
    else{
        return;
    }
}

// Fisher–Yates shuffle 
const shuffle = (cards) => {
    for (let i = 0; i < cards.length; i++) {
      const rnd = Math.random() * i | 0;
      const tmp = cards[i];
      cards[i] = cards[rnd];
      cards[rnd] = tmp;
    }
    return cards;
};

const port= process.env.PORT || 8000
server.listen(port,()=>{
    console.log("Server Listening  on port: "+ port);
})