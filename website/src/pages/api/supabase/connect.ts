import { env } from 'website/src/lib/env'
import { NextRequest, NextResponse } from 'next/server'

import { OAuth2Client, generateCodeVerifier } from 'oslo/oauth2'

export const config = {
    runtime: 'edge',
}

export const redirectUri = new URL(
    `/api/supabase/callback`,
    env.NEXT_PUBLIC_URL,
).toString()

export const supabaseCodeVerifierKey = 'supabase-code-verifier'

const handler = async (req: NextRequest) => {
    try {
        const redirectUrl = req.nextUrl.searchParams.get('redirectUrl') || ''
        const orgId = req.nextUrl.searchParams.get('orgId') || ''
        const slug = req.nextUrl.searchParams.get('slug') || ''
        const client = new OAuth2Client(
            env.SUPA_CONNECT_CLIENT_ID!,
            'https://api.supabase.com/v1/oauth/authorize',
            'https://api.supabase.com/v1/oauth/token',
            {
                redirectURI: redirectUri,
            },
        )
        const codeVerifier = generateCodeVerifier()
        const url = await client.createAuthorizationURL({
            codeVerifier,
            scopes: ['all'],
            state: JSON.stringify({ redirectUrl, orgId, slug }),
        })
        // const [url, state, codeVerifier] =
        //     await createOAuth2AuthorizationUrlWithPKCE(
        //         'https://api.supabase.com/v1/oauth/authorize',
        //         {
        //             clientId: env.SUPA_CONNECT_CLIENT_ID!,
        //             codeChallengeMethod: 'S256',
        //             redirectUri,
        //             state: JSON.stringify({ redirectUrl, orgId, slug }),
        //             scope: ['all'],
        //             searchParams: {
        //                 // access_type: config.accessType ?? 'online',
        //             },
        //         },
        //     )

        console.log('supabase url', url.toString())
        const res = NextResponse.redirect(url.toString(), {})
        res.cookies.set(supabaseCodeVerifierKey, codeVerifier, {
            path: '/',
            // sameSite: 'lax',
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
