import { PORT } from "./config/env.js";
import { connectDB } from "./config/db.js";
import app from "./app.js";

await connectDB(); // Connect to the database
// TODO:
// remove database errors from responses in production and log them instead for debugging
// add a 404 page for undefined routes

app.listen(PORT, () => {
  console.log(`Backend is running on port ${PORT}`);
});
