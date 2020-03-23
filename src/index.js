// -*- mode: js; js-indent-level: 2; -*-
'use strict';
const express = require('express');
//const mysql = require('mysql');
const fs = require('fs');
const bodyParser = require('body-parser');
var uuid = require('uuid/v4');
const aws_keys = require('./aws_keys');
const app = express();
var cors = require('cors');

var AWS = require('aws-sdk');
//AWS.config.loadFromPath('aws_config.json');

//app.use(express.static('web'));
app.use(bodyParser.json({ limit: '5mb', extended: true }));
//app.use(bodyParser.urlencoded({ limit: '10mb', extended: true }));
app.use(cors());

const s3 = new AWS.S3(aws_keys.s3);
const ddb = new AWS.DynamoDB(aws_keys.dynamodb);
const rekognition = new AWS.Rekognition(aws_keys.rekognition);

const port = 3000;
app.listen(port, () => {
  let host = 'localhost';
  console.log('Server is listening on http://%s:%s', host, port)
})


app.post('/validarUsuario', (req, res) => {
  
  let body = req.body;

  let username = body.username;
  let pass = body.password;

  var docClient = new AWS.DynamoDB.DocumentClient(aws_keys.dynamodb);
  var params = {
    TableName: "Usuarios"
  };

  docClient.scan(params, onScan);

  function onScan(err, data) {
    if (err) {
        console.error("Unable to scan the table. Error JSON:", JSON.stringify(err, null, 2));
    } else {
        console.log("Scan succeeded.");

        let existe = 0;
        data.Items.forEach(function(element) {
          if(element.username == username && element.password == pass){
            res.send({ 'mensaje' : '1', 'username': username, 'foto': element.imgLocation });
            existe = 1;
            console.log("Usario encontrado");
          }
        });

        if(existe == 0){
          res.send({ 'mensaje' : '0', 'username' : '' });
          console.log("Usuario o contraseña incorrecta");
        }
        // if (typeof data.LastEvaluatedKey != "undefined") {
        //     console.log("Scanning for more...");
        //     params.ExclusiveStartKey = data.LastEvaluatedKey;
        //     docClient.scan(params, onScan);
        // }
    }
  }
})


app.post('/validarFaceUsuario', (req, res) => {
  
  let body = req.body;
  
  const similarity = 85; //porcentaje de similitud
  const bucketname = 'bucketfotos-9'; //body.bucketname; //nombre de bucket
  const sourceFilepath = body.source; //dirección relativa de la imagen origen (captura o foto)
  var targetFilepath = null; //dirección relativa de la imagen objetivo (foto de perfil)


  var docClient = new AWS.DynamoDB.DocumentClient(aws_keys.dynamodb);
  var params = {
    TableName: "Usuarios"
  };

  docClient.scan(params, onScan);
  let existe = 0;

  async function onScan(err, data) {
    if (err) {
        console.error("Unable to scan the table. Error JSON:", JSON.stringify(err, null, 2));
    } else {
        console.log("Scan succeeded.");

        await reconocimiento(data.Items, similarity, bucketname)
        .then(() => {
          //console.log("Llego aqui...");
          if(existe == 0){
            res.send({ 'mensaje' : '0', 'username' : '' });
            console.log("Usuario o contraseña incorrecta");
          }
        });
    }
  }

  async function reconocimiento(arreglo, similarity, bucketname) {
    for(let i in arreglo){
        if(arreglo[i].name != null){

            targetFilepath = "usuarios/" + arreglo[i].name;
  
            //console.log(targetFilepath);
      
            var params = {
              SimilarityThreshold: similarity,
              SourceImage: { //captura o foto
                  S3Object: {
                    Bucket: bucketname,
                    Name: sourceFilepath
                  }
              },
              TargetImage: { //foto perfil
                S3Object: {
                  Bucket: bucketname,
                  Name: targetFilepath
                }
              }
            };
  
            try{
              let data = await rekognition.compareFaces(params).promise();
              let arrdata = data.FaceMatches;
              if(arrdata.length > 0) {
                console.log("encontrado");
                existe = 1;
                return res.send({ 'mensaje' : '1', 'username' : arreglo[i].username, 'foto': arreglo[i].imgLocation });
              }
              }catch(e ){
              }
          }
    }    
  }

})


app.post('/crearUsuario', (req, res) => {
  let body = req.body;

  //Datos del usuario
  let username = body.username;
  let pass = body.password;

  if(body.name != null && body.base64 != null && body.extension != null){ // guardar usuario con imagen de perfil

    let name = body.name;
    let base64String = body.base64;
    let extension = body.extension;

    let link = "";

    //Decodificar imagen
    let encodedImage = base64String;
    let decodedImage = Buffer.from(encodedImage, 'base64');
    let filename = `${name}-${uuid()}.${extension}`;

    //Parámetros para S3
    let bucketname = 'bucketfotos-9'; //bucketfotos-9
    let folder = 'usuarios/';
    let filepath = `${folder}${filename}`;
    var uploadParamsS3 = {
      Bucket: bucketname,
      Key: filepath,
      Body: decodedImage,
      ACL: 'public-read',
    };

    s3.upload(uploadParamsS3, function sync(err, data) {
      if (err) {
        console.log('Error uploading file:', err);
        res.send({ 'mensaje': '0', 'username' : '' })
      } else {
        link = data.Location;
        console.log('Upload success at:', data.Location);
        ddb.putItem({
          TableName: "Usuarios",
          Item: {
            "username": { S: username },
            "password": { S: pass },
            "name": { S: filename },
            "imgLocation": { S: data.Location }
          }
        }, function (err, data) {
          if (err) {
            console.log('Error saving data:', err);
            res.send({ 'mensaje': '0', 'username' : '' });
          } else {
            console.log('Save success:', data);
            res.send({ 'mensaje' : '1', 'username': username, 'foto': link });
          }
        });
      }
    });
  }
  else{ // guardar solo usuario y contraseña
    ddb.putItem({
      TableName: "Usuarios",
      Item: {
        "username": { S: username },
        "password": { S: pass }
      }
    }, function (err, data) {
      if (err) {
        console.log('Error saving data:', err);
        res.send({ 'mensaje': '0', 'username' : '' });
      } else {
        console.log('Save success:', data);
        res.send({ 'mensaje' : '1', 'username': username });
      }
    });
  }
})


app.post('/subirImagen', (req, res) => {
  let body = req.body;

  //Datos del usuario
  let username = body.username;
  //let pass = body.password;

  let name = body.name;
  let base64String = body.base64;
  let extension = body.extension;

  //Decodificar imagen
  let encodedImage = base64String;
  let decodedImage = Buffer.from(encodedImage, 'base64');
  let filename = `${name}-${uuid()}.${extension}`;

  //Parámetros para S3
  let bucketname = 'bucketfotos-9'; //bucketfotos-9
  let folder = 'fotos/';
  let filepath = `${folder}${filename}`;
  var uploadParamsS3 = {
    Bucket: bucketname,
    Key: filepath,
    Body: decodedImage,
    ACL: 'public-read',
  };

  s3.upload(uploadParamsS3, function sync(err, data) {
    if (err) {
      console.log('Error uploading file:', err);
      res.send({ 'mensaje' : 'Error al subir imagen', 'path': '' });
    } else {
      console.log('Upload success at:', data.Location);
      ddb.putItem({
        TableName: "DirFotos",
        Item: {
          "url": { S: data.Location },
          "name": { S: filename },
          "username": { S: username }
        }
      }, function (err, data) {
        if (err) {
          console.log('Error saving data:', err);
          res.send({ 'mensaje' : 'Error al guardar en BD' });
        } else {
          console.log('Save success:', data);
          res.send({ 'mensaje' : '1', 'path': filepath });
        }
      });
    }
  });
})


app.post('/subirCaptura', (req, res) => {
  let body = req.body;

  let name = body.name;
  let base64String = body.base64;
  let extension = body.extension;

  //Decodificar imagen
  let encodedImage = base64String;
  let decodedImage = Buffer.from(encodedImage, 'base64');
  let filename = `${name}-${uuid()}.${extension}`;

  //Parámetros para S3
  let bucketname = 'bucketfotos-9'; //bucketfotos-9
  let folder = 'capturas/';
  let filepath = `${folder}${filename}`;
  var uploadParamsS3 = {
    Bucket: bucketname,
    Key: filepath,
    Body: decodedImage,
    ACL: 'public-read',
  };

  s3.upload(uploadParamsS3, function sync(err, data) {
    if (err) {
      console.log('Error uploading file:', err);
      res.send({ 'mensaje': '0', 'path' : '' });
    } else {
      console.log('Upload success at:', data.Location);
      res.send({ 'mensaje' : '1', 'path': filepath });
    }
  });
})

app.post('/comparar', (req, res) => {
  
  let body = req.body;
  
  const similarity = 20; //porcentaje de similitud
  const bucketname = 'bucketfotos-9'; //body.bucketname; //nombre de bucket
  const sourceFilepath = body.source; //dirección relativa de la imagen origen (captura o foto)
  var targetFilepath = body.target; //dirección relativa de la imagen objetivo (foto de perfil)


  var params = {
    SimilarityThreshold: similarity,
    SourceImage: {//captura o foto
        S3Object: {
            Bucket: bucketname,
            Name: sourceFilepath
        }
    },
    TargetImage: {//foto perfil
        S3Object: {
            Bucket: bucketname,
            Name: targetFilepath
        }
    }
};

rekognition.compareFaces(params, function(err, data) {
    if (err) {
      console.log(err);
    }
    else {
      console.log(data);
    }
});

})