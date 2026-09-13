import dns from 'node:dns';
import mongoose from 'mongoose';

// Node on this Windows host resolves via 127.0.0.1:53 (c-ares), which
// refuses SRV lookups for mongodb+srv://. Point at public resolvers first.
dns.setServers(['8.8.8.8', '1.1.1.1']);

export async function connectDB(uri) {
  mongoose.set('strictQuery', true);
  await mongoose.connect(uri, {
    serverSelectionTimeoutMS: 15000,
    family: 4,
  });
  const { host, name } = mongoose.connection;
  console.log(`MongoDB connected (${host} / ${name})`);
}
