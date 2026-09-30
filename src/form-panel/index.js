/**
 * Forms to Odoo: the "Odoo" tab of the Contact Form 7 form editor.
 */
import { createRoot } from '@wordpress/element';
import App from './App';
import './editor.scss';

const root = document.getElementById( 'fto-app' );
const store = document.getElementById( 'fto-settings' );
if ( root && store && window.ftoData ) {
	createRoot( root ).render( <App store={ store } /> );
}
