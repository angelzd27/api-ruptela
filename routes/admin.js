import { Router } from 'express'
import { getAllNvrCamerasArtemis, getNvrUnassigned, getCamerasUnassigned, createNvrArtemis, editNvrArtemis, deleteNvrArtemis, getCamerasNvrArtemis, createCameraArtemis, editCameraArtemis, deleteCameraArtemis, nvrAssignedUser, assignNvrArtemis, unassignNvrArtemis } from '../controller/admin/artemis.js'

export const router_admin = Router()

// Artemis NVR Methods
router_admin.post('/nvr-assigned-user', nvrAssignedUser)
router_admin.post('/assign-nvr-artemis', assignNvrArtemis)
router_admin.delete('/unassign-nvr-artemis', unassignNvrArtemis)
router_admin.get('/all-nvr-artemis', getAllNvrCamerasArtemis)
router_admin.get('/all-nvr-unassigned', getNvrUnassigned)
router_admin.post('/create-nvr-artemis', createNvrArtemis)
router_admin.put('/edit-nvr-artemis', editNvrArtemis)
router_admin.delete('/delete-nvr-artemis', deleteNvrArtemis)

// Artemis Cameras Methods
router_admin.get('/all-cameras-artemis', getCamerasNvrArtemis)
router_admin.get('/all-cameras-unassigned', getCamerasUnassigned)
router_admin.post('/create-camera-artemis', createCameraArtemis)
router_admin.put('/edit-camera-artemis', editCameraArtemis)
router_admin.delete('/delete-camera-artemis', deleteCameraArtemis)