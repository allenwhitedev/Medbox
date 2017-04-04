Current status:
Develop test endpoints 
 
Endpoints:

GET /
returns index.html 

GET /testMessages
returns all test messages in json

socket.emit('testMessage', message)
inserts test message to mongo database

To run:
npm install --save all dependencies (listed in package.json)
Add mLab credentials for medbox to a config.js (in root directory)
node server.js
Connect client (open localhost:3000 in browser or Android app)