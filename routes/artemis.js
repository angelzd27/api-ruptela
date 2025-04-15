import { Router } from 'express'
import { getArtemisCameras, getArtemisRegions, getStreamingUrl, getCamerasArtemis } from '../controller/artemis.js'

export const router_artemis = Router()

router_artemis.get('/getArtemisCameras', getArtemisCameras)
router_artemis.get('/getArtemisRegions', getArtemisRegions)
router_artemis.get('/getStreamingUrl', getStreamingUrl)
router_artemis.get('/getCamerasArtemis', getCamerasArtemis)