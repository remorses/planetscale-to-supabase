import { env } from 'website/src/lib/env'

import { NextRequest, NextResponse } from 'next/server'

import { safeJsonParse } from 'website/src/lib/utils'

import {
    redirectUri,
    supabaseCodeVerifierKey,
} from 'website/src/pages/api/supabase/connect'

export const config = {
    runtime: 'edge',
}

const handler = async (req: NextRequest) => {
    try {
        const codeVerifier = req.cookies.get(supabaseCodeVerifierKey)?.value
        const state = safeJsonParse(
            req.nextUrl.searchParams.get('state') || 'null',
        )

        console.log('state', state)
        // console.log('codeVerifier', codeVerifier)
        if (!codeVerifier) throw new Error('No codeVerifier!')
        const clientId = env.SUPA_CONNECT_CLIENT_ID!
        const clientSecret = env.SUPA_CONNECT_CLIENT_SECRET!
        const tokensRes = await fetch(
            'https://api.supabase.com/v1/oauth/token',
            {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                    Accept: 'application/json',
                    Authorization: `Basic ${btoa(
                        `${clientId}:${clientSecret}`,
                    )}`,
                },
                body: new URLSearchParams({
                    grant_type: 'authorization_code',
                    code: req.nextUrl.searchParams.get('code') || '',
                    redirect_uri: redirectUri,
                    code_verifier: codeVerifier,
                }),
            },
        )
        if (!tokensRes.ok) {
            throw new Error(
                `Failed to fetch tokens from Supabase: ${await tokensRes.text()}`,
            )
        }
        const tokens = await tokensRes.json()
        // console.log('tokens', tokens)
        const { access_token, refresh_token } = tokens

        const res = NextResponse.redirect(state.redirectUrl || `/dashboard`, {})
        res.cookies.set('supabaseAccessToken', access_token, {
            path: '/',
            httpOnly: false,
            domain: req.nextUrl.hostname,
        })
        res.cookies.set('supabaseRefreshToken', refresh_token, {
            path: '/',
            httpOnly: false,
            domain: req.nextUrl.hostname,
        })

        return res
    } catch (error: any) {
        console.error(error, 'get-session API')
        return NextResponse.json(error.message, {
            status: 500,
        })
    }
}

export default handler
