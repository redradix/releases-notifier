'use strict';

require('es6-promise').polyfill();
require('isomorphic-fetch');

var sendgrid = require("sendgrid")(process.env.SENDGRID_KEY);
var email = new sendgrid.Email();

const redis = require("redis");
const client = redis.createClient({url: process.env.REDISTOGO_URL});

const npmUrl = 'https://www.npmjs.com/package/';

const versionRegex = /(\d{1,2}\.\d{1,2}\.\d{1,2})/;
const npmVersionRegex = /(\d{1,2}\.\d{1,2}\.\d{1,2})\<\/strong\>\s+is the latest/;
const majorVersionRegex = /(\d{1,2})\.\d{1,2}\.\d{1,2}/;
const minorVersionRegex = /\d{1,2}\.(\d{1,2})\.\d{1,2}/;

const minorDependencies = process.env.MINOR_DEPENDENCIES ? process.env.MINOR_DEPENDENCIES.split(/[ ,]+/) : [];
const packageJsonUrls = process.env.PACKAGE_JSON_URLS ? process.env.PACKAGE_JSON_URLS.split(/[ ,]+/) : [];

client.on("error", function (err) {
  console.error("Error " + err);
});

packageJsonUrls.forEach(packageJsonUrl => {
  fetch(packageJsonUrl)
  .then(response => {
    return response.text();
  })
  .then(text => {
    let parsedText = JSON.parse(text);
    let dependencies = parsedText.dependencies;
    let devDependencies = parsedText.devDependencies;
    let allDependencies = Object.assign(dependencies, devDependencies);

    let allDependenciesArray = Object.keys(allDependencies);

    allDependenciesArray.forEach(dependency => {
      let dependencyPackageJsonVersion = allDependencies[dependency].match(versionRegex)[1];
      client.set(dependency, dependencyPackageJsonVersion);
      getLastVersion(dependency).then(lastVersion => {
        if (lastVersion) {
          client.get(dependency, (err, dependencyPackageJsonVersion) => {
            if (err) console.error('error setting the package json version');
            detectMajorVersion(dependency, dependencyPackageJsonVersion, lastVersion, packageJsonUrl);
          })
        }
      });
    });
  })
  .catch(error => {
    console.error(error);
  });
})

let getLastVersion = (dependency) => {
  return fetch(npmUrl + dependency)
  .then(response => {
    return response.text();
  })
  .then(text => {
    let match = text.match(npmVersionRegex);
    if (match) {
      return match[1];
    } else {
      return false;
    }
  })
  .catch(error => {
    console.error('error: ' + error);
  });
}

let detectMajorVersion = (dependency, dependencyPackageJsonVersion, lastVersion, packageJsonUrl) => {
  let dependencyPackageJsonVersionMajorVersion = dependencyPackageJsonVersion.match(majorVersionRegex)[1];
  let dependencyPackageJsonVersionMinorVersion = dependencyPackageJsonVersion.match(minorVersionRegex)[1];

  let lastVersionMajorVersion = lastVersion.match(majorVersionRegex)[1];
  let lastVersionMinorVersion = lastVersion.match(minorVersionRegex)[1];

  if (parseInt(dependencyPackageJsonVersionMajorVersion) < parseInt(lastVersionMajorVersion)) {
    client.get(dependency + '-' + lastVersion + '-notification', (err, reply) => {
      if (err) console.error('error getting dependency version notification (for major)');
      if (!reply) {
        notify(dependency, dependencyPackageJsonVersion, lastVersion, packageJsonUrl, true);
      }
    })
  } else if ((parseInt(dependencyPackageJsonVersionMinorVersion) < parseInt(lastVersionMinorVersion))  && contains(minorDependencies, dependency)) {
    client.get(dependency + '-' + lastVersion + '-notification', (err, reply) => {
      if (err) console.error('error getting dependency version notification (for minor)');
      if (!reply) {
        notify(dependency, dependencyPackageJsonVersion, lastVersion, packageJsonUrl, false);
      }
    })
  }
}

let notify = (dependency, dependencyPackageJsonVersion, lastVersion, packageJsonUrl, isMajor) => {
  var email = new sendgrid.Email(generateMessage(dependency, dependencyPackageJsonVersion, lastVersion, packageJsonUrl, isMajor));

  email.setTos(process.env.EMAILS.split(/[ ,]+/));

  sendgrid.send(email, function(err, json) {
    if (err) { return console.error(err); }
    console.log(json);
    client.set(dependency + '-' + lastVersion + '-notification', 'true');
  });
}

let generateMessage = (dependency, dependencyPackageJsonVersion, lastVersion, packageJsonUrl, isMajor) => {
  let grade = isMajor ? 'MAJOR' : 'MINOR';
  return {
    'html': '<p>I have detected that in the package.json ' + packageJsonUrl + ' the dependency <b>' + dependency + '</b> has the version <b>' + dependencyPackageJsonVersion + '</b> selected and the last one available is the <b>' + lastVersion + '</b>.</p>' + '<p>Go and check out the last changes!: ' + npmUrl + dependency + '.</p>',
    'subject': '[' + grade + '] ' + dependency + ' ' + lastVersion,
    'from': process.env.SENDER_EMAIL,
    'fromname': process.env.SENDER_NAME
  }
}

function contains(a, obj) {
  for (var i = 0; i < a.length; i++) {
    if (a[i] === obj) {
      return true;
    }
  }
  return false;
}
