let express = require('express')
let app = express()
app.use( express.static('public') )

let mongodb = require('mongodb')
let MongoClient = mongodb.MongoClient

let http = require('http').Server(app)
let io = require('socket.io')(http)

let mongoUrl = process.env.MONGOURL || require('./config').mongoUrl
// global db variable is not best practice and will be refactored
let gDB = null


// Mongo initialization
MongoClient.connect(mongoUrl, (err, db) =>
{
  if (err)
  	return console.log(err)
  console.log('connected to mongo at', mongoUrl)
  gDB = db
})


// Mosca setup
let mosca = require('mosca')
let moscaDB = 
{
	type: 'mongo',
	url: process.env.MONGOURL || require('./config').mongoUrl,
	pubsubCollection: '',
	mongo: {}
}
let settings = 
{
	port: 1883, // change to 883 when you add SSL/TLS
	backend: moscaDB
}
let moscaServer = new mosca.Server(settings)
moscaServer.on('ready', setupMosca)

function setupMosca() 
{
	console.log('Mosca server started')
	socketHandler()
}


// REST endpoints    
app.get('/', (req, res) =>
{
  res.sendFile('index.html')
})

app.get('/testMessages', (req, res) =>
{
	gDB.collection('testMessages').find().toArray( (err, result) =>
	{
    if (err)
      return console.log(err)
    else
      res.json(result)    
	})  
})


// Http initialization
let host = process.env.PORT || 3000
http.listen(host, () =>
{
  console.log('Node server listening on:', host)
})


// Socket events (including mosca)
let socketHandler = () => 
{
  io.on('connection', (socket) =>
  {
  	// socket events (non-mosca)
    console.log('user connected')

    socket.on('disconnect', () =>
    {
      console.log('user disconnected')
    })

    socket.on('test message', (message) =>
    {
	    // store received test messages in mongo
	    let testMessage = { text: message, createdAt: new Date() }
	    gDB.collection('testMessages').insert(testMessage, (err, result) =>
	    {
	      if (err)
	      	return console.log(err)
	      console.log('test message inserted successfully:', message)
	    })
	    
	    console.log('test message received: ', message)
	    io.emit('test message', message )
    })
  
    // socket events (mosca)
    moscaServer.on('clientConnected', (client) => 
    {
	    if (!client) 
	    	return console.log('No client in clientConnected')
	    
	    console.log( 'Mbed board connected:', client.id )
	    socket.emit('debug', {type: 'CLIENT', msg: "You are connected, you being:" + client.id})
    })
    
    // fired when any message is received from mbed
    moscaServer.on('published', (data, client) =>
    {
    	if (!client) // fires with !client once when a client connects and again after subscribe
    		return console.log('Exception: No client in published (ignore)')
    	
    	// conditional logic determined by topic & client.id will change status of prescriptions in mongo
    	console.log( client.id + ' published: ' + data.topic )
    })
    
    // fired when mbed board subscribes to any topic
    moscaServer.on('subscribed', (topic, client) =>
    {   
    	if (!client) // fires with !client once whenever a client connects 
    		return console.log('No client in subscribed')

      console.log( client.id + ' subscribed to ' + topic )
    })


  })

}
