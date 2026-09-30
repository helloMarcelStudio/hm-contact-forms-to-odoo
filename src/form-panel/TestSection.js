/**
 * "Send a test record": creates a real record in Odoo from the mapping as
 * it is on screen (unsaved), with editable test values.
 */
import { __, sprintf } from '@wordpress/i18n';
import apiFetch from '@wordpress/api-fetch';
import { useState } from '@wordpress/element';
import {
	Button,
	ExternalLink,
	Notice,
	Panel,
	PanelBody,
	TextControl,
} from '@wordpress/components';
import { data } from './data';

export default function TestSection( { settings, samples, setSamples } ) {
	const [ sending, setSending ] = useState( false );
	const [ result, setResult ] = useState( null );

	const send = () => {
		setSending( true );
		setResult( null );
		apiFetch( {
			path: '/fto/v1/test-send',
			method: 'POST',
			data: { form_id: data.formId, settings, samples },
		} )
			.then( setResult, ( e ) =>
				setResult( { ok: false, message: e.message } )
			)
			.finally( () => setSending( false ) );
	};

	return (
		<div className="fto-test">
			<h3>{ __( 'Send a test record', 'forms-to-odoo' ) }</h3>
			<p className="description">
				{ __(
					'Creates a real record in Odoo from the mapping above as it is now (no need to save first), filled with the test values below. Nothing is logged and no email is sent.',
					'forms-to-odoo'
				) }
			</p>

			{ Object.keys( samples ).length > 0 && (
				<Panel className="fto-samples">
					<PanelBody
						title={ __( 'Test values', 'forms-to-odoo' ) }
						initialOpen={ false }
					>
						<p className="description">
							{ __(
								'What the form "submits" for the test. Clear a field to test it left empty (e.g. a hidden conditional field).',
								'forms-to-odoo'
							) }
						</p>
						{ Object.keys( samples ).map( ( name ) => (
							<TextControl
								key={ name }
								__nextHasNoMarginBottom
								__next40pxDefaultSize
								label={ `[${ name }]` }
								value={ samples[ name ] }
								onChange={ ( value ) =>
									setSamples( {
										...samples,
										[ name ]: value,
									} )
								}
							/>
						) ) }
					</PanelBody>
				</Panel>
			) }

			<Button
				variant="secondary"
				isBusy={ sending }
				disabled={
					sending || ! settings.mapping.some( ( r ) => r.field )
				}
				onClick={ send }
			>
				{ sending
					? __( 'Sending to Odoo…', 'forms-to-odoo' )
					: __( 'Send a test record', 'forms-to-odoo' ) }
			</Button>

			{ result && <TestResult result={ result } /> }
		</div>
	);
}

function TestResult( { result } ) {
	let message;
	if ( ! result.ok ) {
		message = (
			<>
				<strong>
					{ __( 'Odoo refused the test record:', 'forms-to-odoo' ) }
				</strong>{ ' ' }
				{ result.message }
			</>
		);
	} else if ( result.existing ) {
		message = sprintf(
			/* translators: %s: Odoo contact id */
			__(
				'A contact with this email already exists (#%s): nothing was created.',
				'forms-to-odoo'
			),
			result.id
		);
	} else {
		message =
			sprintf(
				/* translators: 1: Odoo model, 2: record id */
				__( 'Created %1$s #%2$s in Odoo.', 'forms-to-odoo' ),
				result.model,
				result.id
			) +
			' ' +
			__( 'Remember to delete it there once checked.', 'forms-to-odoo' );
	}

	return (
		<Notice
			status={ result.ok ? 'success' : 'error' }
			isDismissible={ false }
			className="fto-test-result"
		>
			<p>{ message }</p>
			{ result.url && (
				<p>
					<ExternalLink href={ result.url }>
						{ __( 'Open in Odoo', 'forms-to-odoo' ) }
					</ExternalLink>
				</p>
			) }
			{ result.ok && ! result.existing && result.partnerId > 0 && (
				<p>
					<ExternalLink href={ result.partnerUrl }>
						{ result.partnerCreated
							? sprintf(
									/* translators: %s: Odoo contact id */
									__(
										'Created contact #%s: delete it too once checked.',
										'forms-to-odoo'
									),
									result.partnerId
								)
							: sprintf(
									/* translators: %s: Odoo contact id */
									__(
										'Linked to contact #%s.',
										'forms-to-odoo'
									),
									result.partnerId
								) }
					</ExternalLink>
				</p>
			) }
			{ result.values && Object.keys( result.values ).length > 0 && (
				<details>
					<summary>{ __( 'Values sent', 'forms-to-odoo' ) }</summary>
					<pre>{ JSON.stringify( result.values, null, 2 ) }</pre>
				</details>
			) }
		</Notice>
	);
}
