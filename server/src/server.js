import 'dotenv/config';
import app from './app.js';
import { connectDB } from './config/db.js';
import { startStaleOrderCron } from './services/expiry.service.js';

const PORT = process.env.PORT || 5000;
const uri = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/nekcart';

await connectDB(uri);
startStaleOrderCron();
app.listen(PORT, () => console.log(`soukcart API on :${PORT}`));
