const express = require('express')
const cors = require('cors');
const { MongoClient, ServerApiVersion } = require('mongodb');
require('dotenv').config()
const jwt = require('jsonwebtoken');
const app = express()
const port = process.env.PORT || 4000


// mid ware 
app.use(cors())
app.use(express.json())




const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.89cjz.mongodb.net/myFirstDatabase?retryWrites=true&w=majority`;

const client = new MongoClient(uri, { useNewUrlParser: true, useUnifiedTopology: true, serverApi: ServerApiVersion.v1 });

function verifyToken(req, res, next) {
    const authorization = req.headers.authorization
    if(!authorization){
        return res.status(401).send({ message: 'Invalid Authorization'})
    }
    const token = authorization.split(' ')[1]
    jwt.verify(token, process.env.ACCESS_TOKEN_SECRET,(err, decoded)=>{
        if(err){
            return res.status(403).send({ message: 'Invalid Access Token' })
        }
        req.decoded = decoded
        next()
    })
}

async function run(){
    try {
        await client.connect()
        const servicesCollection = client.db('doctorsPortal').collection('services')
        const bookingCollection = client.db('doctorsPortal').collection('bookings')
        const usersCollection = client.db('doctorsPortal').collection('users')

        app.get('/services', async(req, res)=>{
            const query = {}
            const cursor = servicesCollection.find(query)
            const services = await cursor.toArray()
            res.send(services)
        })

        app.get('/user',verifyToken, async(req, res)=>{
            const user = await usersCollection.find().toArray()
            res.send(user)
        })

        app.get('/admin/:email',verifyToken, async(req, res)=>{
            const email = req.params.email
            const user = await usersCollection.findOne({email})
            const isAdmin = user.role === 'admin'
            res.send(isAdmin)
        })
        

        app.put('/user/admin/:email',verifyToken, async(req, res)=>{
            const email = req.params.email
            const requester = req.decoded.email
            const requesterAccount = await usersCollection.findOne({email: requester})
            if(requesterAccount.role === 'admin'){
                const filter = {email}
                const updateDoc = {
                    $set: {role: 'admin'},
                };
                const result = await usersCollection.updateOne(filter, updateDoc)
                return res.send({result})
            }
            // return res.status(403).send({ message: 'Invalid Access' })
        })

        app.put('/user/:email', async(req, res)=>{
            const email = req.params.email
            const user = req.body
            const filter = {email}
            const options = { upsert: true };
            const updateDoc = {
                $set: user,
            };
            const result = await usersCollection.updateOne(filter, updateDoc, options)

            const token = jwt.sign({email},process.env.ACCESS_TOKEN_SECRET,{ expiresIn: '6h' })

            res.send({result, token})
        })

        app.get('/available', async(req, res)=>{
            const date = req.query.date 
            const services = await servicesCollection.find().toArray()
            const query = {date}
            const bookings = await bookingCollection.find(query).toArray()
            services.forEach(service => {
                const serviceBookings = bookings.filter(booking=>booking.treatment === service.name)
                const booked = serviceBookings.map(s => s.slot)
                const available = service.slots.filter(s => !booked.includes(s) )
                service.slots = available
                // service.booked = serviceBookings.map(s => s.slot)
            })
            res.send(services)
        })

        app.get('/booking',verifyToken, async (req, res) => {
            const patientEmail = req.query.patient
            const decodedEmail = req.decoded.email
            if(decodedEmail === patientEmail) {
                const query = {patientEmail}
                const bookings = await bookingCollection.find(query).toArray()
                return res.send(bookings)
            }
            else{
                return res.status(403).send({ message: 'Invalid Access' })
            }

        })


        app.post('/booking', async (req, res)=>{
            const booking = req.body
            const query = {treatment: booking.treatment, date: booking.date, patientEmail: booking.patientEmail}
            const existingBooking =await bookingCollection.findOne(query)
            console.log(existingBooking)
            if(existingBooking){
                return res.send({success: false, booking: existingBooking})
            }
            const result = await bookingCollection.insertOne(booking)
            res.send({success: true, result })
        })
    }
    finally{

    }
}
run().catch(console.dir)




app.get('/', (req, res) => {
    res.send('Server Running')
})

app.listen(port, () => {
    console.log('listening on port', port)
})