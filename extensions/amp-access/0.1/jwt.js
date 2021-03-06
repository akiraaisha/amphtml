/**
 * Copyright 2016 The AMP HTML Authors. All Rights Reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS-IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import {
  base64UrlDecode,
  base64UrlDecodeToBytes,
} from '../../../src/utils/base64';
import {stringToBytes} from '../../../src/utils/bytes';
import {pemToBytes} from '../../../src/utils/pem';
import {tryParseJson} from '../../../src/json';


/**
 * @typedef {{
 *   header: !JSONObject,
 *   payload: !JSONObject,
 *   verifiable: string,
 *   sig: string,
 * }}
 */
let JwtTokenInternalDef;


/**
 * Provides helper methods to decode and verify JWT tokens.
 */
export class JwtHelper {

  /**
   * @param {!Window} win
   */
  constructor(win) {

    /** @const {!Window} */
    this.win = win;

    /**
     * Might be `null` if the platform does not support Crypto Subtle.
     * @const @private {?SubtleCrypto}
     */
    this.subtle_ = win.crypto &&
        (win.crypto.subtle || win.crypto.webkitSubtle) || null;
  }

  /**
   * Decodes JWT token and returns its payload.
   * @param {string} encodedToken
   * @return {!JSONObject}
   */
  decode(encodedToken) {
    return this.decodeInternal_(encodedToken).payload;
  }

  /**
   * Whether the signature-verification supported on this platform.
   * @return {boolean}
   */
  isVerificationSupported() {
    return !!this.subtle_;
  }

  /**
   * Decodes HWT token and verifies its signature.
   * @param {string} encodedToken
   * @param {!Promise<string>} pemPromise
   * @return {!Promise<!JSONObject>}
   */
  decodeAndVerify(encodedToken, pemPromise) {
    if (!this.subtle_) {
      throw new Error('Crypto is not supported on this platform');
    }
    const decodedPromise = new Promise(
        resolve => resolve(this.decodeInternal_(encodedToken)));
    return decodedPromise.then(decoded => {
      const alg = decoded.header['alg'];
      if (!alg || alg != 'RS256') {
        // TODO(dvoytenko@): Support other RS* algos.
        throw new Error('Only alg=RS256 is supported');
      }
      return this.importKey_(pemPromise).then(key => {
        const sig = base64UrlDecodeToBytes(decoded.sig);
        return this.subtle_.verify(
          /* options */ {name: 'RSASSA-PKCS1-v1_5'},
          key,
          sig,
          stringToBytes(decoded.verifiable)
        );
      }).then(isValid => {
        if (isValid) {
          return decoded.payload;
        }
        throw new Error('Signature verification failed');
      });
    });
  }

  /**
   * @param {string} encodedToken
   * @return {!JwtTokenInternalDef}
   * @private
   */
  decodeInternal_(encodedToken) {
    // See https://jwt.io/introduction/
    function invalidToken() {
      throw new Error(`Invalid token: "${encodedToken}"`);
    }

    // Encoded token has three parts: header.payload.sig
    // Note! The padding is not allowed by JWT spec:
    // http://self-issued.info/docs/draft-goland-json-web-token-00.html#rfc.section.5
    const parts = encodedToken.split('.');
    if (parts.length != 3) {
      invalidToken();
    }
    return {
      header: tryParseJson(base64UrlDecode(parts[0]), invalidToken),
      payload: tryParseJson(base64UrlDecode(parts[1]), invalidToken),
      verifiable: `${parts[0]}.${parts[1]}`,
      sig: parts[2],
    };
  }

  /**
   * @param {!Promise<string>} pemPromise
   * @return {!Promise<!CryptoKey>}
   */
  importKey_(pemPromise) {
    return pemPromise.then(pem => {
      return this.subtle_.importKey(
        /* format */ 'spki',
        pemToBytes(pem),
        /* algo options */ {
          name: 'RSASSA-PKCS1-v1_5',
          hash: {name: 'SHA-256'},
        },
        /* extractable */ false,
        /* uses */ ['verify']);
    });
  }
}
