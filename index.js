const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
dotenv.config();

const app=express();
const port = process.env.PORT || 5000;


// midleWare
app.use(cors());
app.use(express.json());

// api
app.get('/',(req,res)=>{
    res.send('Campcure server is running');
});


app.listen(port,()=>{
    console.log(`campcure server is running on port ${port}`)
})