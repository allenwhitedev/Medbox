let express = require('express')
let app = express()
app.use( express.static('public') )

let mongodb = require('mongodb')
let MongoClient = mongodb.MongoClient
let ObjectId = mongodb.ObjectId

let http = require('http').Server(app)
let io = require('socket.io')(http)

let bcrypt = require('bcrypt-nodejs')

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

app.get('/prescriptions', (req, res) =>
{
  gDB.collection('prescriptions').find().toArray( (err, result) =>
  {
    if (err)
      return console.log(err)
    else
      res.json(result)    
  })  
})

app.get('/doctorform', (req, res) =>
{
  res.sendFile( __dirname + "/public/" + "doctorform.html" )
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
    
    // room testing
    socket.on('join room', (patientId) =>
    {
      socket.join(patientId)
    })
    socket.on('room message', (message) =>
    {
      io.to('patientId2').emit('room message', "This is a room message for patientId2")
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

    socket.on('create prescription', (data) =>
    {
      let validationResult = validateNewPrescriptionData(data)
      if ( validationResult !== "valid" )
      {
        console.log("Error: invalid create prescription data format")
        socket.emit('create prescription debug', validationResult)
        return
      }
      gDB.collection('prescriptions').insertOne({data}, (err, result) =>
      {
        if (err)
          return console.log(err)
        console.log('Insert prescription successful!')
        socket.emit('create prescription debug', "Success: inserted prescription with id: " + result.insertedId)
      })
    })

    socket.on('create patient', (data) =>
    {
      let validationResult = validateNewPatientData(data)
      if ( validationResult !== "valid" )
      {
        console.log("Error: invalid create patient data format")
        socket.emit('create patient debug', validationResult)
        return
      }
      else
      {
        let hashedPassword = bcrypt.hashSync(data.password, bcrypt.genSaltSync(8), null) 
        data.password = hashedPassword

        gDB.collection('patients').insertOne({data}, (err, result) =>
        {
          if (err)
            return console.log(err)
          console.log('Insert patient successful!')
          // create room for patient (used for patient-specific events )
          socket.emit('create patient debug', "Success: inserted patient with id: " + result.insertedId )
        })        
      }

    })

    socket.on('update patient proximity', (data) =>
    {
      if ( !data._id )
        socket.emit('update patient proximity debug', "Error: invalid patient id")

      if ( data.proximity && data.proximity > 0 && data.proximity < 450 )
      {
        gDB.collection('patients').update({_id: ObjectId(data._id) }, 
          {$set: {proximity: data.proximity} }, (err, result) =>
        {
          if (err)
          {
            console.log(err)
            return socket.emit("update patient proximity debug", err)
          }
          console.log("Update patient proximity successfully")
          socket.emit('update patient proximity debug', "Update proximity to " + data.proximity.toString() + " successful")
        })     
      }

      else
        socket.emit('update patient proximity debug', "Error: invalid proximity (use values between 0 and 450)")

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

// Server helper functions

// validations
let validateNewPrescriptionData = (data) =>
{
  let invalidFields = []

  if (!data.drId)
    invalidFields.push('drId')
  if (!data.drPhoneNumber)
    invalidFields.push('drPhoneNumber')
  if (!data.drFirstName)
    invalidFields.push('drFirstName')
  if (!data.drLastName)
    invalidFields.push('drLastname')
  
  if (!data.patientId)
    invalidFields.push('patientId')
  if (!data.patientFirstName)
    invalidFields.push('patientFirstName')
  if (!data.patientLastName)
    invalidFields.push('patientLastName')
  if (!data.patientBirthdate)
    invalidFields.push('patientBirthdate')
  if (!data.patientAddress)
    invalidFields.push('patientAddress')
  
  if (!data.prescriptionId)
    invalidFields.push('prescriptionId')
  if (!data.prescriptionName)
    invalidFields.push('prescriptionName')
  if (!data.prescriptionName)
    invalidFields.push('prescriptionDose')
  if (!data.prescriptionName)
    invalidFields.push('prescriptionQuantity')

  if (invalidFields.length === 0)
    return "valid"
  else
  {
    let errorString = "Error: invalid data format for create prescription. \n Missing required fields:"

    for (i in invalidFields)
    {
      let tmpString = "\n" + invalidFields[i]
      errorString += "\n " + invalidFields[i]
    }
    return errorString
  }
}

let validateNewPatientData = (data) =>
{
  console.log('validateNewPatientData()')
  let invalidFields = []

  if (!data.firstName)
    invalidFields.push('firstName')
  if (!data.lastName)
    invalidFields.push('lastName')
  if (!data.birthdate)
    invalidFields.push('birthdate')
  if (!data.address)
    invalidFields.push('address')
  if (!data.password)
    invalidFields.push('password')

  if (invalidFields.length === 0)
    return "valid"
  else
  {
    let errorString = "Error: invalid data format for create patient. \n Missing required fields:"

    for (i in invalidFields)
    {
      let tmpString = "\n" + invalidFields[i]
      errorString += "\n " + invalidFields[i]
    }
    return errorString
  }
}



