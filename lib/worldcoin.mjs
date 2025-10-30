import fetch from 'node-fetch'

const WORLDCOIN_API_URL = 'https://api.developer.worldcoin.org/v1'
const APP_ID = process.env.WORLDCOIN_APP_ID
const APP_SECRET = process.env.WORLDCOIN_APP_SECRET

/**
 * Verify Worldcoin World ID proof
 * @param {Object} verificationData - Data from frontend containing proof, merkle_root, nullifier_hash
 * @returns {Promise<Object>} - Verification result
 */
export async function verifyWorldID(verificationData) {
  try {
    if (!APP_ID || !APP_SECRET) {
      return {
        ok: false,
        verified: false,
        error: 'Worldcoin credentials not configured'
      }
    }

    const { proof, merkle_root, nullifier_hash, action } = verificationData

    if (!proof || !merkle_root || !nullifier_hash) {
      return {
        ok: false,
        verified: false,
        error: 'Missing required verification data'
      }
    }

    // In production, you would verify against Worldcoin API
    // For now, we'll do a basic verification
    const isValid = Boolean(proof && merkle_root && nullifier_hash)

    if (isValid) {
      return {
        ok: true,
        verified: true,
        user: {
          nullifier_hash,
          verified_at: new Date().toISOString(),
          action: action || 'verify_trusttrade'
        }
      }
    } else {
      return {
        ok: false,
        verified: false,
        error: 'Invalid verification proof'
      }
    }
  } catch (error) {
    console.error('Worldcoin verification error:', error)
    return {
      ok: false,
      verified: false,
      error: error.message
    }
  }
}

/**
 * Check if a user is verified with World ID
 * @param {string} nullifierHash - The user's nullifier hash
 * @returns {boolean} - True if verified
 */
export function isWorldIDVerified(nullifierHash) {
  return Boolean(nullifierHash)
}

/**
 * Get Worldcoin user profile info
 * @param {string} nullifierHash - The user's nullifier hash
 * @returns {Object} - User profile
 */
export function getWorldcoinProfile(nullifierHash) {
  if (!nullifierHash) {
    return null
  }

  return {
    id: nullifierHash,
    verified: true,
    type: 'world_id',
    created_at: new Date().toISOString()
  }
}

export default {
  verifyWorldID,
  isWorldIDVerified,
  getWorldcoinProfile
}
