import { pool_db } from '../../connection/connection.js'
import axios from 'axios'
import https from 'https'
import crypto, { randomUUID } from 'crypto'
import dotenv from 'dotenv'
import { v4 as uuidv4 } from 'uuid'

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

export const getAllNvrCamerasArtemis = async (request, response) => {
    const query = `
        SELECT
            regions_nvr.id,
            regions_nvr.name,
            regions_nvr.status,
            regions_nvr.last_update,
            COALESCE(
                json_agg(cameras_region.id) FILTER (WHERE cameras_region.id IS NOT NULL),
                '[]'
            ) AS cameras
        FROM regions_nvr
        LEFT JOIN region_camera ON regions_nvr.id = region_camera.region_id
        LEFT JOIN cameras_region ON region_camera.camera_id = cameras_region.id
        GROUP BY regions_nvr.id, regions_nvr.name, regions_nvr.status, regions_nvr.last_update;
    `
    const { rows } = await pool_db.query(query)

    return response.json({ error: false, data: rows })
}

export const nvrAssignedUser = async (request, response) => {
    try {
        const { user_id } = request.body
        const query = `
            SELECT regions_nvr.id, regions_nvr.name
            FROM regions_nvr
            JOIN user_region_nvr
            ON regions_nvr.id = user_region_nvr.region_id
            WHERE user_region_nvr.user_id = $1
        `
        const { rows } = await pool_db.query(query, [user_id])
        return response.json({ error: false, data: rows })
    } catch (error) {
        return response.status(500).json({ error: true, data: error.message })
    }
}

export const assignNvrArtemis = async (request, response) => {
    try {
        const { user_id, artemis_nvr_id } = request.body
        const query = `
            INSERT INTO user_region_nvr (user_id, region_id)
            VALUES ($1, $2)
        `
        await pool_db.query(query, [user_id, artemis_nvr_id])
        return response.json({ error: false, message: 'NVR assigned' })
    } catch (error) {
        return response.status(500).json({ error: true, data: error.message })
    }
}

export const unassignNvrArtemis = async (request, response) => {
    try {
        const { user_id, artemis_nvr_id } = request.body
        const query = `
            DELETE FROM user_region_nvr
            WHERE user_id = $1 AND region_id = $2
        `
        await pool_db.query(query, [user_id, artemis_nvr_id])
        return response.json({ error: false, message: 'NVR unassigned' })
    } catch (error) {
        return response.status(500).json({ error: true, data: error.message })
    }
}

export const getNvrUnassigned = async (request, response) => {
    const signature = createSignature('POST', 'application/json', pathArtemisRegions, appSecret, appKey)

    const axiosInstance = axios.create({
        httpsAgent: new https.Agent({ rejectUnauthorized: false })
    })

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

    if (data.code != 0) return response.json({ error: true, data: 'error_artemis' })

    const query = `
        SELECT id, name, status, created_at, last_update
        FROM regions_nvr
        WHERE status = true
    `

    const { rows } = await pool_db.query(query)

    const getNvrUnassigned = data.data.list.filter(item => !rows.some(row => row.id == item.encodeDevIndexCode))

    const nvrUnassigned = getNvrUnassigned.map(item => ({ id: item.encodeDevIndexCode, name: item.encodeDevName }))

    return response.json({ error: false, data: nvrUnassigned })
}

export const getCamerasUnassigned = async (request, response) => {
    const signature = createSignature('POST', 'application/json', pathArtemisCameras, appSecret, appKey)

    const axiosInstance = axios.create({
        httpsAgent: new https.Agent({ rejectUnauthorized: false })
    })

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

    if (data.code != 0) return { error: true, data: 'error_artemis' }

    const query = `
        SELECT id, name
        FROM cameras_region
    `

    const { rows } = await pool_db.query(query)
    const getCamerasUnassigned = data.data.list.filter(item => !rows.some(row => row.id == item.cameraIndexCode)).map(item => ({ id: item.cameraIndexCode, name: item.cameraName }))

    return response.json({ error: false, data: getCamerasUnassigned })
}

export const createNvrArtemis = async (request, response) => {
    const { region, cameras } = request.body
    const id = uuidv4()
    const query = `
        INSERT INTO regions_nvr (id, name)
        VALUES ($1, $2)
    `
    await pool_db.query(query, [id, region])
    cameras.forEach(async camera => {
        const query = `
            INSERT INTO region_camera (region_id, camera_id)
            VALUES ($1, $2)
        `
        await pool_db.query(query, [id, camera])
    })

    return response.json({ error: false, message: 'NVR created' })
}

export const editNvrArtemis = async (request, response) => {
    const { id, region, cameras } = request.body
    const query = `
        UPDATE regions_nvr
        SET name = $2, last_update = NOW()
        WHERE id = $1
    `
    await pool_db.query(query, [id, region])
    const queryDelete = `
        DELETE FROM region_camera
        WHERE region_id = $1
    `
    await pool_db.query(queryDelete, [id])
    cameras.forEach(async camera => {
        const query = `
            INSERT INTO region_camera (region_id, camera_id)
            VALUES ($1, $2)
        `
        await pool_db.query(query, [id, camera])
    })

    return response.json({ error: false, message: 'NVR edited' })
}

export const deleteNvrArtemis = async (request, response) => {
    const { id } = request.body

    const queryDelete = `
        DELETE FROM region_camera
        WHERE region_id = $1
    `
    await pool_db.query(queryDelete, [id])
    const query = `
        DELETE FROM regions_nvr
        WHERE id = $1
    `
    await pool_db.query(query, [id])

    return response.json({ error: false, message: 'NVR deleted' })
}

export const getCamerasNvrArtemis = async (request, response) => {
    const query = `
        SELECT id, name, latitude, longitude, last_update, status
        FROM cameras_region
    `

    const { rows } = await pool_db.query(query)
    return response.json({ error: false, data: rows })
}

export const createCameraArtemis = async (request, response) => {
    const { camera_id, name, latitude, longitude, status } = request.body
    const streamUrl = await getUrlStreaming(camera_id)
    const query = `
        INSERT INTO cameras_region (id, name, latitude, longitude, url, status)
        VALUES ($1, $2, $3, $4, $5, $6)
    `
    await pool_db.query(query, [camera_id, name, latitude, longitude, streamUrl, status])
    return response.json({ error: false, message: 'camera_created' })
}

export const editCameraArtemis = async (request, response) => {
    const { camera_id, name, latitude, longitude, status } = request.body

    const query = `
        UPDATE cameras_region
        SET name = $2, latitude = $3, longitude = $4, status = $5, last_update = NOW()
        WHERE id = $1
    `

    await pool_db.query(query, [camera_id, name, latitude, longitude, status])

    return response.json({ error: false, message: 'camera_edited' })
}

export const deleteCameraArtemis = async (request, response) => {
    const { camera_id } = request.body

    const query = `
        DELETE FROM cameras_region
        WHERE id = $1
    `
    await pool_db.query(query, [camera_id])

    return response.json({ error: false, message: 'camera_deleted' })
}

const getUrlStreaming = async (camera_id) => {
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
                cameraIndexCode: camera_id,
                streamType: 0,
                protocol: 'hls',
                transmode: 1,
                requestWebsocketProtocol: 0,
            }
        })

        if (data.code == 0) {
            return data.data.url
        }

        throw new Error('Error fetching streaming URL')
    } catch (error) {
        console.error(error.response?.data || error.message)
        throw new Error(error.response?.data || error.message)
    }
}