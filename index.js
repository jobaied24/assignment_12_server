const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const { default: Stripe } = require('stripe');
dotenv.config();

const app = express();
const port = process.env.PORT || 5000;
const stripe = require('stripe')(process.env.PAYMENT_SECRET_KEY);
const { initializeApp, cert } = require("firebase-admin/app");
const { getAuth } = require("firebase-admin/auth");


// midleWare
app.use(cors());
app.use(express.json());

const decodedKey = Buffer.from(process.env.FB_SERVICE_KEY,'base64').toString('utf8');

const serviceAccount = JSON.parse(decodedKey);

// admin.initializeApp({
//   credential: admin.credential.cert(serviceAccount)
// });
initializeApp({
  credential: cert(serviceAccount),
});


// verify token
const verifyToken = async(req,res,next) =>{
  const authorization = req.headers?.authorization;

  if(!authorization){
    return res.status(401).send({message:'Unauthorized access'});
  };

  const token = authorization.split(' ')[1];


  if(!token){
    return res.status(401).send({message:'Unauthorized access'});
  }

  try{
    const decoded = await getAuth().verifyIdToken(token);
     req.decoded = decoded;

     
  next();
  }
  catch{
    return res.status(401).send({message:'Forbidden access'})
  }
};


// verify Organizer
const verifyOrganizer = async(req,res,next)=>{
  const email = req.decoded.email;
  const user = await usersCollection.findOne({email});

  if(!user || user.role !== 'organizer'){
    return res.status(403).send({message:'Forbidden access'});
  };

  next();
}


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
    const feedbackCollection = db.collection('feedback');


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
    app.get('/registeredCamp',verifyToken, async (req, res) => {

      const email = req.query.email;
      const query = {
        participantEmail: email
      }
      const result = await campRegistrationCollection.find(query).toArray();
      res.send(result);
    });


    // specific registration
    app.get('/registeredCamp/:id',verifyToken, async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };

      const result = await campRegistrationCollection.findOne(query);
      res.send(result);
    });


    // all registered camps
    app.get('/allRegisteredCamp',async(req,res)=>{
     const result = await campRegistrationCollection.find().toArray();
     res.send(result);
    })


    // payment Intent
    app.post("/create-payment-intent",verifyToken, async (req, res) => {
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
    app.post('/payments',verifyToken, async (req, res) => {
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
     app.get('/paymentHistory',verifyToken,async(req,res)=>{
      const email = req.query.email;
      const query = {
        participantEmail:email
      };

      const result = await paymentCollection.find(query)
      .sort({paidAt:-1})
      .toArray();

      res.send(result);
    });


    // Add Medical Camp
    app.post('/addCamps',verifyToken,verifyOrganizer, async (req, res) => {
      const campData = req.body;

      const result = await campsCollection.insertOne(campData);
      res.send(result);
    });



    // update medical camp
    app.put('/update-camp/:campId',verifyToken,verifyOrganizer,async(req,res)=>{
      const id = req.params.campId;
      const query = {_id:new ObjectId(id)};

      const updateDoc = {
        $set:{
                  ...req.body,
        updateAt:new Date().toISOString()
        }
      };

      const result = await campsCollection.updateOne(query,updateDoc);
      res.send(result);
      
    });


    // save camp registration
    app.post('/campRegistration',verifyToken, async (req, res) => {
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

    // update confirmation status
    app.patch('/update-confirmationStatus/:id',async(req,res)=>{
     const id = req.params.id;
     const query = {_id:new ObjectId(id)};

     const updateDoc = {
      $set:{
        confirmationStatus:'confirmed'
      }
     };

     const updateRes = await campRegistrationCollection.updateOne(query,updateDoc);
     res.send(updateDoc);

    })


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

    // getting user role
    app.get('/users/:email/role',async(req,res)=>{
     try{
      const email = req.params.email;

      if(!email){
        return res.status(400).send({message:'Email is required'});
      };
      
      const user = await usersCollection.findOne({email});

      if(!user){
        return res.status(404).send({message:'User not found'});
      };

      res.send({role:user?.role || 'participant'});
    }
    catch(error){
     return res.status(500).send({message:'Failed to get user'})
    }

    });    


    // feedback and rating
    app.post('/feedbackRating',verifyToken,async(req,res)=>{
      const data = req.body;
      const feedbackData = {
        ...data,
        createAt:new Date().toISOString()
      };

      const result = await feedbackCollection.insertOne(feedbackData);
      res.send(result);
    })


    // cancel regestered camp
    app.delete('/campRegistration/:id',verifyToken, async (req, res) => {
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


    // delete camp
    app.delete('/delete-camp/:campId',verifyToken,verifyOrganizer,async(req,res)=>{
      const campId = req.params.campId;
      const query = {_id:new ObjectId(campId)};

      const result = await campsCollection.deleteOne(query);
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



app.listen(port, () => {
  console.log(`campcure server is running on port ${port}`)
})