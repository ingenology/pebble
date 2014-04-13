var http = require('http');
var express = require('express');
var googleapis = require('googleapis');
var OAuth2 = googleapis.auth.OAuth2;
var oauthClients = {};

var app = express();

var panels =
	[
		{ format: 0, path: '/next-event/alviss/Alviss' },
		{ format: 0, path: '/next-event/alviss/Wife' },
		{ format: 1, path: '/gmt' },
		{ format: 2, path: '/vitals' }
	];

app.use(express.json());

app.options('*', function(request, response)
	{
		console.log('OPTIONS: *');
		
		response.set({
			"Access-Control-Allow-Origin": "*",
			"Access-Control-Allow-Methods": "POST, GET, PUT, DELETE, OPTIONS",
			"Access-Control-Allow-Credentials": false,
			"Access-Control-Max-Age": "86400",
			"Access-Control-Allow-Headers": "X-Requested-With, X-HTTP-Method-Override, Content-Type, Accept" });
		response.send(200);
	});

app.get('/panels', function(request, response)
	{
		console.log('GET:  /panels');
		
		response.set('Content-Type', 'application/json');
		response.send(200,
			{
				panels: panels
			});
	});

	/*
app.post('/panels/:user/:calendarName', function(request, response)
	{
		console.log('POST:  /panels');

		panels.push({ format: 0, path: '/next-event/' + request.params.user + '/' + request.params.calendarName });
		
		response.send(200);
	});

app.delete('/panels/:panelIndex', function(request, response)
	{
		console.log('DELETE:  /panels/' + request.params.panelIndex);
		
		panels.splice(parseInt(request.params.panelIndex), 1);

		response.send();
	});
*/

app.get('/weather', function(request, response)
	{
		console.log('GET:  /weather');

		http.get({ host: 'api.openweathermap.org', port: 80, path: '/data/2.5/weather?q=Kansas%20City,US' }, function(weatherResponse)
			{
				var buffer = '';
				weatherResponse.on('data', function(chunk) { buffer += chunk; });
				weatherResponse.on('end', function(error)
					{
						var data = JSON.parse(buffer);
						//response.send({content: {weather: data.weather, main: data.main, wind: data.wind, clouds: data.clouds}, refresh_frequency: 10 });
						response.send({content: data.weather[0].description + '\n' + data.main.temp, refresh_frequency: 1 });
					});
			});
	});

var gmtRegex = /\d\d\d\d-\d\d-\d\dT(\d\d:\d\d):\d\d\+00:00/;
app.get('/gmt', function(request, response)
	{
		console.log('GET:  /gmt');

		http.get({ host: 'www.timeapi.org', port: 80, path: '/utc/now' }, function(timeResponse)
			{
				var buffer = '';
				timeResponse.on('data', function(chunk) { buffer += chunk; });
				timeResponse.on('end', function(error)
					{
						//2014-04-12T15:15:46+00:00
						var match = gmtRegex.exec(buffer);
						response.send({time: match[1]});
					});
			});
	});

app.get('/oauth2/:user', function(request, response)
	{
		console.log('GET:  /oauth2/' + request.params.user + '?code=' + request.query.code);
		oauthClients[request.params.user].getToken(request.query.code, function(error, tokens)
			{
				console.log(tokens);
				oauthClients[request.params.user].setCredentials(tokens);
				response.send();
			});
	});

app.get('/calendar-auth/:user', function(request, response)
	{
		console.log('/calendar-auth/' + request.params.user);
		
		var client = new OAuth2('444649227197-0o87frrvtmv9keaeub4pljvmhfpt38p6.apps.googleusercontent.com', '1-NWEyFlfW3IaLjvgDQl1_kM', 'http://' + request.headers.host + '/oauth2/' + request.params.user);
		oauthClients[request.params.user] = client;
		
		var url = client.generateAuthUrl({
			access_type: 'offline',
			scope: 'https://www.googleapis.com/auth/calendar'
		});
		response.redirect(url);
	});

app.get('/calendar/:user', function(request, response)
	{
		console.log('/calendar/' + request.params.user);
		googleapis
			.discover('calendar', 'v3')
			.execute(function(error, client)
				{
					client.calendar.calendarList.list()
						.withAuthClient(oauthClients[request.params.user])
						.execute(function(error, calendarResponse)
							{
								console.log('Response from google (', calendarResponse, ') error (', error, ')');
								response.send(calendarResponse);
							});
				});
	});

app.get('/next-event/:user/:calName', function(request, response)
	{
		console.log('/next-event/' + request.params.user + '/' + request.params.calName);
		googleapis
			.discover('calendar', 'v3')
			.execute(function(error, client)
				{
					client.calendar.calendarList.list()
						.withAuthClient(oauthClients[request.params.user])
						.execute(function(error, calendars)
							{
								if (error)
								{
									response.type('application/json');
									response.send({calName: "N/A", eventText: "" });
									return;
								}
								
								for (var i = 0; i < calendars.items.length; ++i)
								{
									if (calendars.items[i].summary === request.params.calName)
									{
										var calName = calendars.items[i].summary;
										client.calendar.events.list(
											{
												calendarId: calendars.items[i].id,
												timeMin: new Date(Date.now()).toISOString(),
												maxResults: 5,
												singleEvents: true,
												orderBy: 'startTime'
											})
											.withAuthClient(oauthClients[request.params.user])
											.execute(function(error, events)
												{
													if (events && events.items && events.items.length > 0)
													{
														for (var i = 0; i < events.items.length; ++i)
														{
															var ev = events.items[i];
															var d = Date.parse(ev.start.dateTime);
															if (d > Date.now())
															{
																response.type('application/json');
																var startTime = new Date(d);
																var eventName = ev.summary;
																if (eventName.length > 15) eventName = eventName.substr(0, 12) + "...";
																response.send({calName: calName, eventText: eventName + "\n" + startTime.toLocaleTimeString() + "\n" + startTime.toLocaleDateString() });
																return;
															}
														}
													}
													response.type('application/json');
													response.send({calName: calName, eventText: "no upcoming event" });
													return;
												});
										return;
									}
								}

								response.send(404, { error: 'Could not find calendar with name \"' + request.params.calName + '\".' });
							});
				});
	});

app.get('/vitals', function(request, response)
	{
		console.log('GET:  /vitals');

		http.get({ host: 'user.humanapi.co', port: 80, path: '/v1/human' }, function(vitalsResponse)
			{
				var buffer = '';
				vitalsResponse.on('data', function(chunk) { buffer += chunk; });
				vitalsResponse.on('end', function(error)
					{
						var data = JSON.parse(buffer);
						response.type('application/json');
						response.send(
							{
								systolic: data.bloodPressure.value.systolic + ' ' + data.bloodPressure.unit,
								diastolic: data.bloodPressure.value.diastolic + ' ' + data.bloodPressure.unit,
								heartRate: data.heartRate.value + ' ' + data.heartRate.unit
							});
					});
			});
	});
	
app.listen(980);
console.log('Listening on port 980...');
