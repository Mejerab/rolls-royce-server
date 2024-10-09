const express = require('express');
const app = express();
const jwt = require('jsonwebtoken');
const nodemailer = require('nodemailer');
const cookieParser = require('cookie-parser');
require('dotenv').config()
const cors = require('cors');
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const port = process.env.PORT || 5000;
const stripe = require('stripe')(process.env.STRIPE_SECRET)

// Middleware
app.use(cors({
    origin: [
        'http://localhost:5173'
    ],
    credentials: true
}))
app.use(express.json())
app.use(cookieParser())

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.xegw8vb.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`;

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
    serverApi: {
        version: ServerApiVersion.v1,
        strict: true,
        deprecationErrors: true,
    }
});

// Middleware
const verifyToken = (req, res, next) => {
    const token = req.cookies.token;
    if (!token) {
        res.status(401).send({ message: 'Unauthorized Access' });
    }
    jwt.verify(token, process.env.TOKEN_SECRET, (err, decode) => {
        if (err) {
            res.status(403).send({ message: 'Forbidden Access' })
        }
        req.decode = decode;
        next();
    })
}

const cookieOptions = {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production' ? false : true,
    sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'strict',
}

const carCollection = client.db('rollsRoyce').collection('cars');
const orderCollection = client.db('rollsRoyce').collection('orders');
const purchaseCollection = client.db('rollsRoyce').collection('purchases');
const paymentCollection = client.db('rollsRoyce').collection('payments');

// Mailer
const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: process.env.EMAIL,
        pass: 'ydsvszwgzxgxatps'
    }
})

async function run() {
    try {
        // Connect the client to the server	(optional starting in v4.7)
        await client.connect();

        app.post('/jwt', async (req, res) => {
            const user = req.body;
            const token = jwt.sign(user, process.env.TOKEN_SECRET, { expiresIn: '1h' });
            res.cookie('token', token).send({ success: true })
        })
        app.post('/logout', async (req, res) => {
            const user = req.body;
            console.log('Logged out user', user);
            res.clearCookie('token', { ...cookieOptions, maxAge: 0 }).send({ success: false })
        })
        app.get('/cars', async (req, res) => {
            const result = await carCollection.find().toArray();
            res.send(result);
        })
        app.get('/cars/:page', async (req, res) => {
            const type = req.query.type;
            const page = parseInt(req.params.page);
            console.log('page', page);
            const result = await carCollection.find()
                .skip((page - 1) * 9)
                .limit(page === 1 && type !== 'ascendic' ? 10 : 9)
                .sort(type === 'ascendic' ? { price: -1 } : { price: 1 })
                .toArray();
            res.send(result)
        })
        app.get('/cars/id/:id', async (req, res) => {
            const id = req.params.id;
            const query = { _id: new ObjectId(id) }
            const result = await carCollection.findOne(query);
            res.send(result);
        })
        app.post('/orders', async (req, res) => {
            const data = req.body;
            const result = await orderCollection.insertOne(data);
            res.send(result);
        })
        app.get('/orders', verifyToken, async (req, res) => {
            const { email, type } = req.query;
            if (req?.decode?.email !== email) {
                res.status(403).send({ message: 'Forbidden Access' });
            }
            const result = await orderCollection.find({ status: 'pending' })
                .sort(type === 'ascendic' ? { price: -1 } : { price: 1 })
                .toArray();
            res.send(result);
        })
        app.get('/orders/:id', verifyToken, async (req, res) => {
            const id = req.params.id;
            const query = { _id: new ObjectId(id) };
            const result = await orderCollection.findOne(query);
            res.send(result);
        })
        app.patch('/orders/patch/:id', verifyToken, async(req ,res)=>{
            const { email } = req.query;
            if (req?.decode?.email !== email) {
                res.status(403).send({ message: 'Forbidden Access' });
            }
            const id = req.params.id;
            const data = req.body;
            const filter = {_id: new ObjectId(id)};
            const updatedDoc = {
                $set: {
                    ...data
                }
            };
            const options = {upsert: true};
            const result = await orderCollection.updateOne(filter, updatedDoc, options);
            res.send(result)
        })
        app.delete('/orders/:id', async (req, res) => {
            const id = req.params.id;
            const query = { _id: new ObjectId(id) };
            const result = await orderCollection.deleteOne(query);
            res.send(result);
        })

        // Purchase
        app.post('/purchase', async (req, res) => {
            const data = req.body;
            const result = await purchaseCollection.insertOne(data);
            res.send(result);
        })
        app.get('/purchase/:email', verifyToken, async (req, res) => {
            const {email} = req.params;
            if (req?.decode?.email !== email) {
                return res.status(403).send({message: 'Forbidden Access'});
            }
            const result = await purchaseCollection.find({ email }).toArray();
            res.send(result);
        })
        app.get('/purchase/stat/:email', verifyToken, async (req, res) => {
            const { email } = req.params;
            if (req.decode?.email !== email) {
                res.status(403).send({ message: 'Forbidden Access' });
            }
            const items = await purchaseCollection.find({ email }).toArray();
            const total = items.reduce((sum, item) => sum + parseInt(item.price.slice(1)), 0)
            res.send({ total });
        })

        // Payment
        app.post('/create-payment-intent', async (req, res) => {
            const {price} = req.body;
            const amount = parseInt(price * 100);
            const payment = await stripe.paymentIntents.create({
                amount: amount,
                currency: 'usd',
                payment_method_types: ['card']
            })
            res.send({
                clientSecret: payment.client_secret
            })
        })
        app.post('/payments/:email', verifyToken, async(req, res)=>{
            const {email} = req.params;
            if (req?.decode?.email !== email) {
                return res.status(403).send({message: 'Forbidden Access'});
            }
            const data = req.body;
            const result = await paymentCollection.insertOne(data);
            const query = {
                _id: {
                    $in: data.cart_id.map(id=> new ObjectId(id))
                }
            };
            const deleteAll = await purchaseCollection.deleteMany(query);
            const mailOptions = {
                form: 'mejerabxd@gmail.com',
                to: req?.decode?.email,
                subject: 'Thnks for your purchase.',
                html: `
                  <h3>Your payments is successfully done.</h3>
                  <p>Thanks for your purchase. This is a comfirmation that your payment is been done successfully. You paid ${parseInt(data?.amount /100)} dollars for your dream car. Congratulations! Your car will be there very soon.</p>
                  <h5>FROM: Rolls royce motor cars family</h5>
                `
            }
            transporter.sendMail(mailOptions, (error, info)=>{
                if (error) {
                    return console.log(error);
                }
                if (info) {
                    console.log(info.response);
                }
            })
            res.send({result, deleteAll})
        })
        app.get('/payments/:email', verifyToken, async(req, res)=>{
            const {email} = req.params;
            console.log(email);
            
            if (req?.decode?.email !== email) {
                return res.status(403).send({message: 'Forbidden Access'})
            }
            const result = await paymentCollection.find({email}).toArray();
            res.send(result);
        })

        // Send a ping to confirm a successful connection
        await client.db("admin").command({ ping: 1 });
        console.log("Pinged your deployment. You successfully connected to MongoDB!");
    } finally {
        // Ensures that the client will close when you finish/error
        // await client.close();
    }
}
run().catch(console.dir);

app.get('/', (req, res) => {
    res.send('Royce is running');
})
app.listen(port, () => {
    console.log('Server is runnung on', port);
})