const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');

dotenv.config();

const app = express();
const port = process.env.PORT || 5000;

const stripe = require('stripe')(process.env.PAYMENT_SECRET_KEY);

const { initializeApp, cert } = require("firebase-admin/app");
const { getAuth } = require("firebase-admin/auth");

// Middleware
app.use(cors());
app.use(express.json());

const decodedKey = Buffer.from(process.env.FB_SERVICE_KEY, 'base64').toString('utf8');
const serviceAccount = JSON.parse(decodedKey);

initializeApp({
  credential: cert(serviceAccount),
});

// Verify token middleware
const verifyToken = async (req, res, next) => {
  const authorization = req.headers?.authorization;

  if (!authorization) {
    return res.status(401).send({ message: 'Unauthorized access' });
  }

  const token = authorization.split(' ')[1];

  if (!token) {
    return res.status(401).send({ message: 'Unauthorized access' });
  }

  try {
    const decoded = await getAuth().verifyIdToken(token);
    req.decoded = decoded;
    next();
  } catch {
    return res.status(401).send({ message: 'Forbidden access' });
  }
};

// MongoDB Setup
const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.hota77b.mongodb.net/?appName=Cluster0`;

const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  }
});

const db = client.db('campcure_db');
const campsCollection = db.collection('camps');
const usersCollection = db.collection('users');
const campRegistrationCollection = db.collection('campRegistration');
const paymentCollection = db.collection('payments');
const feedbackCollection = db.collection('feedback');

// Verify Organizer middleware
const verifyOrganizer = async (req, res, next) => {
  const email = req.decoded.email;
  const user = await usersCollection.findOne({ email });

  if (!user || user.role !== 'organizer') {
    return res.status(403).send({ message: 'Forbidden access' });
  }

  next();
};

// Root route
app.get('/', (req, res) => {
  res.send('Campcure server is running');
});

// --- API ROUTES ---

// Get all camps
app.get('/camps', async (req, res) => {
  const search = req.query.search;
  const sort = req.query.sort;
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 10;
  let query = {};
  let sortOption = {};

  if (search) {
    query = {
      $or: [
        { campName: { $regex: search, $options: 'i' } },
        { location: { $regex: search, $options: 'i' } },
        { healthcareProfessional: { $regex: search, $options: 'i' } }
      ]
    };
  }

  if (sort === "registered") sortOption = { participantCount: -1 };
  else if (sort === "fees") sortOption = { campFees: 1 };
  else if (sort === "alphabetical") sortOption = { campName: 1 };

  const total = await campsCollection.countDocuments(query);

  let cursor = campsCollection
    .find(query)
    .sort(sortOption)
    .collation({ locale: "en", strength: 2 });

  if (page && limit) {
    const skip = (page - 1) * limit;
    cursor = cursor.skip(skip).limit(limit);
  }

  const result = await cursor.toArray();

  res.send({
    result,
    total,
    currentPage: page || 1,
    totalPages: limit ? Math.ceil(total / limit) : 1,
  });
});

// Specific camp data
app.get('/camps/:campId', async (req, res) => {
  const campId = req.params.campId;
  const query = { _id: new ObjectId(campId) };
  const result = await campsCollection.findOne(query);
  res.send(result);
});

// Registered camp
app.get('/registeredCamp', verifyToken, async (req, res) => {
  const email = req.query.email;
  const search = req.query.search;
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 10;
  const skip = (page - 1) * limit;

  let query = { participantEmail: email };

  if (search) {
    query = {
      participantEmail: email,
      $or: [
        { campName: { $regex: search, $options: "i" } },
        { healthcareProfessional: { $regex: search, $options: "i" } },
        { dateTime: { $regex: search, $options: "i" } }
      ]
    };
  }

  const total = await campRegistrationCollection.countDocuments(query);
  const result = await campRegistrationCollection
    .find(query)
    .skip(skip)
    .limit(limit)
    .toArray();

  res.send({
    result,
    total,
    currentPage: page,
    totalPages: Math.ceil(total / limit),
  });
});

// Specific registration
app.get('/registeredCamp/:id', verifyToken, async (req, res) => {
  const id = req.params.id;
  const query = { _id: new ObjectId(id) };
  const result = await campRegistrationCollection.findOne(query);
  res.send(result);
});

// All registered camps
app.get('/allRegisteredCamp', async (req, res) => {
  const search = req.query.search;
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 10;
  const skip = (page - 1) * limit;

  let query = {};

  if (search) {
    query = {
      $or: [
        { campName: { $regex: search, $options: 'i' } },
        { participantName: { $regex: search, $options: 'i' } },
        { campDate: { $regex: search, $options: 'i' } }
      ]
    };
  }

  const total = await campRegistrationCollection.countDocuments(query);
  const result = await campRegistrationCollection
    .find(query)
    .skip(skip)
    .limit(limit)
    .toArray();

  res.send({
    result,
    total,
    totalPages: Math.ceil(total / limit)
  });
});

// Payment Intent
app.post("/create-payment-intent", verifyToken, async (req, res) => {
  const { campFees } = req.body;
  const fees = campFees * 100;

  const paymentIntent = await stripe.paymentIntents.create({
    amount: fees,
    currency: 'usd',
    payment_method_types: ['card']
  });

  res.send({ clientSecret: paymentIntent.client_secret });
});

// Payment history and status update
app.post('/payments', verifyToken, async (req, res) => {
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

  res.send({ paymentRes, updateStatus });
});

// Get payment history
app.get('/paymentHistory', verifyToken, async (req, res) => {
  const email = req.query.email;
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 10;
  const search = req.query.search || '';
  const skip = (page - 1) * limit;

  let query = { participantEmail: email };

  if (search) {
    query = {
      participantEmail: email,
      $or: [
        { campName: { $regex: search, $options: 'i' } },
        { healthcareProfessional: { $regex: search, $options: 'i' } },
        { campDate: { $regex: search, $options: 'i' } }
      ]
    };
  }

  const total = await paymentCollection.countDocuments(query);
  const result = await paymentCollection
    .find(query)
    .skip(skip)
    .sort({ paidAt: -1 })
    .limit(limit)
    .toArray();

  res.send({
    result,
    total,
    totalPages: Math.ceil(total / limit)
  });
});

// Add Medical Camp
app.post('/addCamps', verifyToken, verifyOrganizer, async (req, res) => {
  const campData = req.body;
  const result = await campsCollection.insertOne(campData);
  res.send(result);
});

// Update medical camp
app.put('/update-camp/:campId', verifyToken, verifyOrganizer, async (req, res) => {
  const id = req.params.campId;
  const query = { _id: new ObjectId(id) };

  const updateDoc = {
    $set: {
      ...req.body,
      updateAt: new Date().toISOString()
    }
  };

  const result = await campsCollection.updateOne(query, updateDoc);
  res.send(result);
});

// Save camp registration
app.post('/campRegistration', verifyToken, async (req, res) => {
  const registrationData = req.body;
  const { campId } = registrationData;
  const query = { _id: new ObjectId(campId) };

  const result = await campRegistrationCollection.insertOne(registrationData);

  const updateDoc = {
    $inc: { participantCount: 1 }
  };

  await campsCollection.updateOne(query, updateDoc);
  res.send(result);
});

// Update confirmation status
app.patch('/update-confirmationStatus/:id', async (req, res) => {
  const id = req.params.id;
  const query = { _id: new ObjectId(id) };

  const updateDoc = {
    $set: { confirmationStatus: 'confirmed' }
  };

  const updateRes = await campRegistrationCollection.updateOne(query, updateDoc);
  res.send(updateDoc);
});

// User info
app.post('/users', async (req, res) => {
  const email = req.body.email;
  const userInfo = req.body;
  const ExistUser = await usersCollection.findOne({ email });

  if (ExistUser) {
    return res.status(200).send({ message: 'User already exists', inserted: false });
  }

  const result = await usersCollection.insertOne(userInfo);
  res.send(result);
});

// Getting user role
app.get('/users/:email/role', async (req, res) => {
  try {
    const email = req.params.email;

    if (!email) {
      return res.status(400).send({ message: 'Email is required' });
    }

    const user = await usersCollection.findOne({ email });

    if (!user) {
      return res.status(404).send({ message: 'User not found' });
    }

    res.send({ role: user?.role || 'participant' });
  } catch (error) {
    return res.status(500).send({ message: 'Failed to get user' });
  }
});

// Getting user data
app.get('/users/:email', async (req, res) => {
  const email = req.params.email;
  const result = await usersCollection.findOne({ email });
  return res.send(result);
});

// Update user profile info
app.patch('/users/profile/:email', verifyToken, async (req, res) => {
  try {
    const email = req.params.email;
    const { phone } = req.body;

    if (email !== req.decoded.email) {
      return res.status(403).send({ message: 'Forbidden access' });
    }

    const query = { email };
    const updateDoc = { $set: { phone } };

    const result = await usersCollection.updateOne(query, updateDoc);
    res.send(result);
  } catch (error) {
    return res.status(500).send({ message: 'Failed to update Profile' });
  }
});

// Feedback and rating
app.post('/feedbackRating', verifyToken, async (req, res) => {
  const data = req.body;
  const feedbackData = {
    ...data,
    createAt: new Date().toISOString()
  };

  const result = await feedbackCollection.insertOne(feedbackData);
  res.send(result);
});

app.get('/feedbackRating', verifyToken, async (req, res) => {
  const feedbackRating = await feedbackCollection.find().toArray();
  res.send(feedbackRating);
});

// Cancel registered camp
app.delete('/campRegistration/:id', verifyToken, async (req, res) => {
  const id = req.params.id;
  const query = { _id: new ObjectId(id) };

  const registration = await campRegistrationCollection.findOne(query);

  if (!registration) {
    return res.status(404).send({ message: 'Registration not found' });
  }

  const deleteResult = await campRegistrationCollection.deleteOne(query);

  const campId = registration.campId;
  const campQuery = { _id: new ObjectId(campId) };
  const updateDoc = { $inc: { participantCount: -1 } };

  await campsCollection.updateOne(campQuery, updateDoc);
  res.send(deleteResult);
});

// Cancel registered camp by organizer
app.delete('/organizer/campRegistration/:id', verifyToken, verifyOrganizer, async (req, res) => {
  const id = req.params.id;
  const query = { _id: new ObjectId(id) };

  const registration = await campRegistrationCollection.findOne(query);

  if (!registration) {
    return res.status(404).send({ message: 'Registration not found' });
  }

  const deleteResult = await campRegistrationCollection.deleteOne(query);

  const campId = registration.campId;
  const campQuery = { _id: new ObjectId(campId) };
  const updateDoc = { $inc: { participantCount: -1 } };

  await campsCollection.updateOne(campQuery, updateDoc);
  res.send(deleteResult);
});

// Delete camp
app.delete('/delete-camp/:campId', verifyToken, verifyOrganizer, async (req, res) => {
  const campId = req.params.campId;
  const query = { _id: new ObjectId(campId) };

  const result = await campsCollection.deleteOne(query);
  res.send(result);
});

// For local testing
if (process.env.NODE_ENV !== 'production') {
  app.listen(port, () => {
    console.log(`Server running on port ${port}`);
  });
}

module.exports = app;