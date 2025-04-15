import axios from 'axios'
import https from 'https'
import crypto from 'crypto'
import dotenv from 'dotenv'
import jwt from 'jsonwebtoken'
import { pool_db } from '../connection/connection.js'

dotenv.config()

const appKey = '20257509'
const appSecret = 'YjdpuTcEdqsWvRnHlpH4'
const host = 'https://148.230.181.49'
const pathArtemisCameras = '/artemis/api/resource/v1/cameras'
const pathArtemisRegions = '/artemis/api/resource/v1/encodeDevice/encodeDeviceList'
const pathArtemisStreaming = '/artemis/api/video/v1/cameras/previewURLs'

function createSignature(method, contentType, path, appSecret, appKey) {
    const stringToSign = `${method}\napplication/json, text/plain, */*\n${contentType}\nx-ca-key:${appKey}\n${path}`
    return crypto.createHmac('sha256', appSecret).update(stringToSign).digest('base64')
}

export const getArtemisCameras = async (request, response) => {
    const signature = createSignature('POST', 'application/json', pathArtemisCameras, appSecret, appKey)

    const axiosInstance = axios.create({
        httpsAgent: new https.Agent({ rejectUnauthorized: false })
    })

    try {
        const { data } = await axiosInstance({
            url: `${host}${pathArtemisCameras}`,
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-ca-key': appKey,
                'x-ca-signature': signature,
                'x-ca-signature-headers': 'x-ca-key',
                'Accept': 'application/json, text/plain, */*'
            },
            data: {
                pageNo: 1,
                pageSize: 200
            }
        })

        if (data.code == 0) return response.json({ error: false, data: data.data.list })

        return response.json({ error: true, data: data })
    } catch (error) {
        console.error(error.response?.data || error.message)
        return response.status(500).json({ error: true, message: error.response?.data || error.message })
    }
}

export const getArtemisRegions = async (request, response) => {
    const signature = createSignature('POST', 'application/json', pathArtemisRegions, appSecret, appKey)

    const axiosInstance = axios.create({
        httpsAgent: new https.Agent({ rejectUnauthorized: false })
    })

    try {
        const { data } = await axiosInstance({
            url: `${host}${pathArtemisRegions}`,
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-ca-key': appKey,
                'x-ca-signature': signature,
                'x-ca-signature-headers': 'x-ca-key',
                'Accept': 'application/json, text/plain, */*'
            },
            data: {
                pageNo: 1,
                pageSize: 200
            }
        })

        if (data.code == 0) return response.json({ error: false, data: data.data.list })

        return response.json({ error: true, data: data })
    } catch (error) {
        console.error(error.response?.data || error.message)
        return response.status(500).json({ error: true, message: error.response?.data || error.message })
    }
}

export const getStreamingUrl = async (request, response) => {
    const { cameraId } = request.query
    const signature = createSignature('POST', 'application/json', pathArtemisStreaming, appSecret, appKey)

    const axiosInstance = axios.create({
        httpsAgent: new https.Agent({ rejectUnauthorized: false })
    })

    try {
        const { data } = await axiosInstance({
            url: `${host}${pathArtemisStreaming}`,
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-ca-key': appKey,
                'x-ca-signature': signature,
                'x-ca-signature-headers': 'x-ca-key',
                'Accept': 'application/json, text/plain, */*'
            },
            data: {
                cameraIndexCode: cameraId,
                streamType: 0,
                protocol: 'hls',
                transmode: 1,
                requestWebsocketProtocol: 0,
            }
        })

        if (data.code == 0) {
            const { url } = data.data
            const proxyUrl = `${process.env.COVIA_BACKEND}/hls-proxy?target=${encodeURIComponent(url)}`
            return response.json({ error: false, data: { url: proxyUrl } })
        }

        return response.json({ error: true, data: data })
    } catch (error) {
        console.error(error.response?.data || error.message)
        return response.status(500).json({ error: true, message: error.response?.data || error.message })
    }
}

export const getCamerasArtemis = async (request, response) => {
    try {
        const { authorization } = request.headers
        const { id } = jwt.verify(authorization, process.env.SECRET_KEY)
        const query = `
            SELECT cr.id, cr.name, cr.latitude, cr.longitude, cr.url, cr.status, cr.last_update
            FROM cameras_region cr
            JOIN region_camera rc
            ON cr.id = rc.camera_id
            JOIN user_region_nvr urn
            ON rc.region_id = urn.region_id
            WHERE urn.user_id = $1
            AND cr.status = true
        `
        const { rows } = await pool_db.query(query, [id])
        rows.map(row => {
            row.url = `${process.env.COVIA_BACKEND}/hls-proxy?target=${encodeURIComponent(row.url)}`
            row.online = "1"
        })
        return response.json({ error: false, data: rows })
    } catch (error) {
        console.error(error)
        return response.status(500).json({ error: true, message: error, data: [] })
    }
}