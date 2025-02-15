# Carpool webapp

This is initially just an app for registering a trip log for a carpool in order to debit each user for the car usage.

## Documentation for used libraries

* TailwindCSS https://v2.tailwindcss.com/docs
* React
* Vite
* ShadCN 
* Lucide (icons) https://lucide.dev/

## Starting development environment

Emulator for the database:
`firebase emulators:start --import ./emulated_database --export-on-exit`

Export data, if "export-on-exit" isn't used:
`firebase emulators:export ./emulated_database`

Run the app locally:
`npm run dev`

Run tests:
`npm run test`

Build the app for deployment:
`npm run build`

Deploy to preview channel:
`firebase hosting:channel:deploy <preview_name>`

Deploy to production:
`firebase deploy`
