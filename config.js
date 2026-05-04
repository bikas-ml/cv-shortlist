"use strict";
require("dotenv").config();

module.exports = {
  GEMINI_API_KEY: process.env.GEMINI_API_KEY,
  SUPABASE_URL:   process.env.SUPABASE_URL,
  SUPABASE_KEY:   process.env.SUPABASE_KEY,
  DB_CONN:        process.env.DB_CONN,
  TOKEN_SECRET:   process.env.TOKEN_SECRET,
};
