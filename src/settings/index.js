/**
 * Forms to Odoo: Settings → Forms to Odoo (connection and send log).
 */
import { __, sprintf } from '@wordpress/i18n';
import { createRoot, useState } from '@wordpress/element';
import { addQueryArgs, getQueryArg, removeQueryArgs } from '@wordpress/url';
import { TabPanel } from '@wordpress/components';
import ConnectionTab from './ConnectionTab';
import LogTab from './LogTab';
import './admin.scss';

// { failed, retentionDays, formsUrl }
const data = window.ftoData || {};

function App() {
	const [ failed, setFailed ] = useState( data.failed || 0 );
	const url = window.location.href;
	const status = getQueryArg( url, 'status' );

	return (
		<TabPanel
			className="fto-tabs"
			initialTabName={
				getQueryArg( url, 'tab' ) === 'log' ? 'log' : 'connection'
			}
			onSelect={ ( tab ) =>
				// the tab is kept in the URL, so a reload stays on it
				window.history.replaceState(
					null,
					'',
					tab === 'log'
						? addQueryArgs( window.location.href, { tab: 'log' } )
						: removeQueryArgs(
								window.location.href,
								'tab',
								'status'
							)
				)
			}
			tabs={ [
				{
					name: 'connection',
					title: __( 'Connection', 'forms-to-odoo' ),
				},
				{
					name: 'log',
					title: failed
						? sprintf(
								/* translators: %d: number of failed sends */
								__( 'Log (%d failed)', 'forms-to-odoo' ),
								failed
							)
						: __( 'Log', 'forms-to-odoo' ),
				},
			] }
		>
			{ ( tab ) =>
				tab.name === 'log' ? (
					<LogTab
						initialStatus={
							[ 'sent', 'pending', 'failed' ].includes( status )
								? status
								: ''
						}
						retentionDays={ data.retentionDays }
						onCounts={ ( counts ) => setFailed( counts.failed ) }
					/>
				) : (
					<ConnectionTab />
				)
			}
		</TabPanel>
	);
}

const root = document.getElementById( 'fto-settings-app' );
if ( root ) {
	createRoot( root ).render( <App /> );
}
