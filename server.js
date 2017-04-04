let express = require('express')
let app = express()
app.use( express.static('public') )

let mongodb = require('mongodb')
let MongoClient = mongodb.MongoClient

let http = require('http').Server(app)
let io = require('socket.io')(http)

let mongoUrl = require('./config').mongoUrl
// global db variable is not best practice and will be refactored
let gDB = null


MongoClient.connect(mongoUrl, (err, db) =>
{
	if (err)
		return console.log(err)
	console.log('connected to mongo at', mongoUrl)
	gDB = db
})
	

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


let host = process.env.PORT || 3000
http.listen(host, () =>
{
	console.log('Node server listening on:', host)
})


// socket events
io.on('connection', (socket) =>
{
	console.log('user connected')

	socket.on('disconnect', ()=>
	{
		console.log('user disconnected')
	})

	// socket events
	socket.on('test message', (message) =>
	{
		// store received test messages in mongo
		let testMessage = {text: message, createdAt: new Date()}
		gDB.collection('testMessages').insert(testMessage, (err, result) =>
		{
			if (err)
				return console.log(err)
			console.log('test message inserted successfully:', message)
		})
		
		console.log('test message received: ', message)
		io.emit('test message', message )
	})


})