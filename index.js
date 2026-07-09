const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const { default: Stripe } = require('stripe');
dotenv.config();

const app = express();
const port = process.env.PORT || 5000;
const stripe = require('stripe')(process.env.PAYMENT_SECRET_KEY);


// midleWare
app.use(cors());
app.use(express.json());

// api
app.get('/', (req, res) => {
  res.send('Campcure server is running');
});



const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.hota77b.mongodb.net/?appName=Cluster0`;

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  }
});

async function run() {
  try {
    // Connect the client to the server	(optional starting in v4.7)
    await client.connect();

    const db = client.db('campcure_db');
    const campsCollection = db.collection('camps');
    const usersCollection = db.collection('users');
    const campRegistrationCollection = db.collection('campRegistration');
    const paymentCollection = db.collection('payments');


    // get all camps
    app.get('/camps', async (req, res) => {
      const search = req.query.search;
      const limit = parseInt(req.query.limit);
      let query = {};

      if (search) {
        query = {
          $or: [
            {
              campName: {
                $regex: search,
                $options: 'i'
              }
            },
            {
              location: {
                $regex: search,
                $options: 'i'
              }
            },
            {
              healthcareProfessional: {
                $regex: search,
                $options: 'i'
              }
            }
          ]
        }
      }

      const cursor = await campsCollection.find(query);

      if (limit) {
        cursor.limit(limit);
      };

      const result = await cursor.toArray();
      res.send(result);
    });


    // specific camp data
    app.get('/camps/:campId', async (req, res) => {
      const campId = req.params.campId;
      const query = { _id: new ObjectId(campId) };
      const result = await campsCollection.findOne(query);
      res.send(result);
    });


    // registered camp
    app.get('/registeredCamp', async (req, res) => {
      const email = req.query.email;
      const query = {
        participantEmail: email
      }
      const result = await campRegistrationCollection.find(query).toArray();
      res.send(result);
    });


    // specific registration
    app.get('/registeredCamp/:id', async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };

      const result = await campRegistrationCollection.findOne(query);
      res.send(result);
    });



    // payment Intent
    app.post("/create-payment-intent", async (req, res) => {
      const { campFees } = req.body;
      const fees = campFees * 100;

      const paymentIntent = await stripe.paymentIntents.create({
        amount: fees,
        currency: 'usd',
        payment_method_types: ['card']
      });

      res.send({ clientSecret: paymentIntent.client_secret });
    });


    // pament history and update payment status
    app.post('/payments', async (req, res) => {
      const paymentData = req.body;

      const payment = {
        ...paymentData,
        paymentStatus: 'paid',
        paidAt: new Date().toISOString()
      };

      const paymentRes = await paymentCollection.insertOne(payment);

      const id = req.body.registrationId;
      const query = { _id: new ObjectId(id) };

      const updateDoc = {
        $set: {
          paymentStatus: 'paid',
          transactionId: paymentData.transactionId,
          paidAt: new Date().toISOString(),
        }
      };

      const updateStatus = await campRegistrationCollection.updateOne(query, updateDoc);

      res.send({
        paymentRes,
        updateStatus
      })

    });


    // get payment history
    app.get('/paymentHistory',async(req,res)=>{
      const email = req.query.email;
      const query = {
        participentEmail:email
      };

      const result = await paymentCollection.find(query)
      .sort({paidAt:-1})
      .toArray();

      res.send(result);
    });


    // Add Medical Camp
    app.post('/addCamps', async (req, res) => {
      const campData = req.body;

      const result = await campsCollection.insertOne(campData);
      res.send(result);
    });


    // save camp registration
    app.post('/campRegistration', async (req, res) => {
      const registrationData = req.body;
      const { campId } = registrationData;
      const query = { _id: new ObjectId(campId) };

      // save camp registrationData
      const result = await campRegistrationCollection.insertOne(registrationData);

      // update participent count
      const updateDoc = {
        $inc: {
          participantCount: 1
        }
      };

      const countResult = await campsCollection.updateOne(query, updateDoc);

      res.send(result);
    });




    // user info
    app.post('/users', async (req, res) => {
      const email = req.body.email;
      const userInfo = req.body;
      const ExistUser = await usersCollection.findOne({ email });

      if (ExistUser) {
        return res.status(200).send({ message: 'User already exists', inserted: false });
      };

      const result = await usersCollection.insertOne(userInfo);
      res.send(result);

    });


    // cancel regestered camp
    app.delete('/campRegistration/:id', async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };

      const registration = await campRegistrationCollection.findOne(query);

      if (!registration) {
        return res.status(404).send({
          message: 'Registration not found'
        });
      }

      const deleteResult = await campRegistrationCollection.deleteOne(query);

      // participantCount update
      const campId = registration.campId;
      const campQuery = { _id: new ObjectId(campId) };

      const updateDoc = {
        $inc: {
          participantCount: -1
        }
      };

      await campsCollection.updateOne(campQuery, updateDoc);

      res.send(deleteResult);

    });



    // Send a ping to confirm a successful connection
    await client.db("admin").command({ ping: 1 });
    console.log("Pinged your deployment. You successfully connected to MongoDB!");
  } finally {
    // Ensures that the client will close when you finish/error
    // await client.close();
  }
}
run().catch(console.dir);



app.listen(port, () => {
  console.log(`campcure server is running on port ${port}`)
})