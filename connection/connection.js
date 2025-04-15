import pg from 'pg'
import dotenv from 'dotenv'
import { decrypt } from '../utils/encrypt.js'

dotenv.config()

export const pool_db = new pg.Pool({
    user: process.env.USER_PG,
    host: process.env.HOST_PG,
    database: process.env.DATABASE_PG,
    password: process.env.PASSWORD_PG,
    port: process.env.PORT_PG
})