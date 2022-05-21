const express = require('express')
const cors = require('cors');
const nodemailer = require('nodemailer');
const sgTransport = require('nodemailer-sendgrid-transport');
const { MongoClient, ServerApiVersion , ObjectId } = require('mongodb');
require('dotenv').config()
const jwt = require('jsonwebtoken');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

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

const options = {
    auth: {
        api_key: process.env.EMAIL_SEND_KEY
    }
}
const  emailClient = nodemailer.createTransport(sgTransport(options));

function sendMail(booking) {
    const {patientEmail, patientName, date, slot, treatment} = booking

    const email = {
        from: process.env.EMAIL_SENDER ,
        to: patientEmail,
        subject: `Your Appointment For ${treatment} Is On ${date} At ${slot} Is Confirmed`,
        text: `Your Appointment For ${treatment} Is On ${date} At ${slot} Is Confirmed`,
        html: `
            <div>
                <p>Hello ${patientName},</p>
                <h3>Your Appointment For ${treatment} Is Confirmed</h3>
                <p>Looking Forward To See You On ${date} At ${slot}</p>
                <h3>ICT Tower (14th Floor) Plot: E-14/X, Dhaka 1207</h3>
                <p>Bangladesh</p>
            </div>
        `
    };

    emailClient.sendMail(email, function(err, info){
        if (err ){
            console.log(err);
        }
        else {
            console.log('Message sent: ', info);
        }
    });
}


// function sendPaymentMail(booking) {
//     const {patientEmail, patientName, date, slot, treatment} = booking

//     const email = {
//         from: process.env.EMAIL_SENDER ,
//         to: patientEmail,
//         subject: `We Have Received Your Payment For ${treatment}`,
//         text: `Your Payment For ${treatment} Is On ${date} At ${slot} Is Confirmed`,
//         html: `
//             <div>
//                 <p>Hello ${patientName},</p>
//                 <h3>Your Appointment For ${treatment} Is Confirmed</h3>
//                 <h3>Your Appointment For ${treatment} Is Confirmed</h3>
//                 <p>Looking Forward To See You On ${date} At ${slot}</p>
//                 <h3>ICT Tower (14th Floor) Plot: E-14/X, Dhaka 1207</h3>
//                 <p>Bangladesh</p>
//             </div>
//         `
//     };

//     emailClient.sendPaymentMail(email, function(err, info){
//         if (err ){
//             console.log(err);
//         }
//         else {
//             console.log('Message sent: ', info);
//         }
//     });
// }


async function run(){
    try {
        await client.connect()
        const servicesCollection = client.db('doctorsPortal').collection('services')
        const bookingCollection = client.db('doctorsPortal').collection('bookings')
        const usersCollection = client.db('doctorsPortal').collection('users')
        const doctorCollection = client.db('doctorsPortal').collection('doctors')
        const paymentCollection = client.db('doctorsPortal').collection('payments')

        const verifyAdmin = async(req, res,next)=>{
            const requester = req.decoded.email
            const requesterAccount = await usersCollection.findOne({email: requester})
            if(requesterAccount.role === 'admin'){
                next()
            }else{
                res.status(403).send({ message: 'Invalid Access' })
            }
        }

        app.post('/create-payment-intent',async (req, res)=>{
            const service = req.body
            console.log(service);
            const price = service.price
            const amount = price * 100
            console.log(amount);
            const paymentIntent = await stripe.paymentIntents.create({
                amount : amount,
                currency : 'USD',
                payment_method_types: ['card']
            })
            res.send({ clientSecret: paymentIntent.client_secret, })
        })

        app.get('/services', async(req, res)=>{
            const query = {}
            const cursor = servicesCollection.find(query).project({name: 1})
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
        

        app.put('/user/admin/:email',verifyToken,verifyAdmin, async(req, res)=>{
            const email = req.params.email
            
                const filter = {email}
                const updateDoc = {
                    $set: {role: 'admin'},
                };
                const result = await usersCollection.updateOne(filter, updateDoc)
                return res.send({result})
            // }
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

            const token = jwt.sign({email},process.env.ACCESS_TOKEN_SECRET,{ expiresIn: '7d' })

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

        app.get('/booking/:id',verifyToken,async (req, res) => {
            const id = req.params.id
            const query = {_id: ObjectId(id)}
            const booking = await bookingCollection.findOne(query)
            res.send(booking)
        })

        app.post('/booking', async (req, res)=>{
            const booking = req.body
            const query = {treatment: booking.treatment, date: booking.date, patientEmail: booking.patientEmail}
            const existingBooking =await bookingCollection.findOne(query)
            if(existingBooking){
                return res.send({success: false, booking: existingBooking})
            }
            const result = await bookingCollection.insertOne(booking)
            sendMail(booking)
            res.send({success: true, result })
        })

        app.put('/booking/:id',verifyToken, async(req, res) => {
            const id = req.params.id
            const payment = req.body
            const filter = {_id: ObjectId(id)} 
            const options = { upsert: true };
            const updateDoc = {
                $set: {
                    paid : true,
                    transactionId: payment.transactionId
                },
            };
            const result = await paymentCollection.insertOne(payment)
            const updatedBooking = await bookingCollection.updateOne(filter,updateDoc, options )
            // res.send({updatedBooking, result})
            res.send(updateDoc)
        })


        app.get('/doctor', verifyToken, verifyAdmin, async(req, res)=>{
            const doctors = await doctorCollection.find().toArray()
            res.send(doctors)
        })


        app.post('/doctor', verifyToken, verifyAdmin, async(req, res) => {
            const doctor = req.body
            const result = await doctorCollection.insertOne(doctor)
            res.send(result)
        })

        app.delete('/doctor/:email', verifyToken, verifyAdmin, async(req, res) => {
            const email =req.params.email
            const filter ={email: email}
            const result = await doctorCollection.deleteOne(filter)
            res.send(result)
        })

        app.delete('/booking/:id', async (req, res) => {
            const id =req.params.id
            const filter ={_id: ObjectId(id)}
            console.log(filter)
            const result = await bookingCollection.deleteOne(filter)
            res.send(result)
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