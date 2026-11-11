
require('dotenv').config();

const app = require('./app');
const { connectDatabase } = require('./config/database');

const PORT = process.env.PORT || 3000;

async function startServer() {
  try {
    await connectDatabase();

    app.listen(PORT, () => {
      console.log(`Server running at http://localhost:${PORT}`);
    });
  } catch (error) {
    console.error('Failed to start application:', error.message);
    process.exit(1);
  }
}

startServer();
