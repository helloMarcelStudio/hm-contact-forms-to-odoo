/**
 * Schematic summary next to the mapping: what a submission with the test
 * values would create in Odoo (form → record → contact), computed by the
 * server like a real submission, without sending anything.
 */
import { __, sprintf } from '@wordpress/i18n';
import apiFetch from '@wordpress/api-fetch';
import { useEffect, useState } from '@wordpress/element';
import { Spinner } from '@wordpress/components';
import { data, usePanel, useRecords } from './data';
import { HelpTip } from './controls';

export default function Summary( { settings, samples } ) {
	const { fields } = usePanel();
	const [ preview, setPreview ] = useState( null ); // { values, contact }
	const [ error, setError ] = useState( '' );
	const request = JSON.stringify( { settings, samples } );

	useEffect( () => {
		let live = true;
		const timer = setTimeout( () => {
			apiFetch( {
				path: '/fto/v1/summary',
				method: 'POST',
				data: { form_id: data.formId, ...JSON.parse( request ) },
			} ).then(
				( r ) => {
					if ( live ) {
						setPreview( r );
						setError( '' );
					}
				},
				( e ) => live && setError( e.message )
			);
		}, 400 );
		return () => {
			live = false;
			clearTimeout( timer );
		};
	}, [ request ] );

	const isPartner = settings.model === 'res.partner';
	const contact = settings.contact?.enabled ? preview?.contact : null;
	const linkField =
		! isPartner && settings.contact?.enabled ? settings.contact.field : '';
	const values = preview?.values || {};
	const rows = settings.mapping.filter( ( r ) => r.field );
	// the contact field, filled at send time, unless the mapping sets it
	const showLink = linkField && ! rows.some( ( r ) => r.field === linkField );

	return (
		<aside
			className="fto-summary"
			aria-label={ __( 'Summary', 'forms-to-odoo' ) }
		>
			<h3 className="fto-heading-help">
				{ __( 'What Odoo receives', 'forms-to-odoo' ) }
				<HelpTip
					text={ __(
						'Computed with the test values, exactly like a real submission. Nothing is sent to Odoo.',
						'forms-to-odoo'
					) }
				/>
			</h3>
			{ ! settings.enabled && (
				<p className="fto-summary-off">
					{ __(
						'Sending is off: nothing is sent until you turn it on above.',
						'forms-to-odoo'
					) }
				</p>
			) }

			<div className="fto-node is-source">
				<span className="fto-node-kind">
					{ __( 'Form submission on the website', 'forms-to-odoo' ) }
				</span>
				<strong>{ data.formTitle }</strong>
			</div>

			<div className="fto-arrow">
				<span>
					{ isPartner && contact
						? __( 'finds or creates', 'forms-to-odoo' )
						: __( 'creates', 'forms-to-odoo' ) }
				</span>
			</div>

			<div className="fto-node is-record">
				<div className="fto-node-head">
					<strong>
						{ data.models[ settings.model ] || settings.model }
					</strong>
					<code>{ settings.model }</code>
				</div>
				{ isPartner && contact && (
					<p className="fto-node-note">
						{ sprintf(
							/* translators: %s: email address */
							__(
								'Not created again when a contact already has %s.',
								'forms-to-odoo'
							),
							contact.email
						) }
					</p>
				) }
				{ error && <p className="fto-error">{ error }</p> }
				{ ! preview && ! error && <Spinner /> }
				{ preview && (
					<dl className="fto-values">
						{ rows.map( ( row ) => (
							<SummaryRow
								key={ row.field }
								label={
									fields[ row.field ]?.label || row.field
								}
								field={ fields[ row.field ] }
								value={ values[ row.field ] }
								linked={ row.field === linkField }
							/>
						) ) }
						{ showLink && (
							<div className="fto-value is-link">
								<dt>
									{ fields[ linkField ]?.label || linkField }
								</dt>
								<dd>
									{ __(
										'the contact below',
										'forms-to-odoo'
									) }
								</dd>
							</div>
						) }
					</dl>
				) }
			</div>

			{ linkField && preview && (
				<ContactNode
					contact={ contact }
					settings={ settings }
					label={ fields[ linkField ]?.label || linkField }
				/>
			) }
		</aside>
	);
}

function ContactNode( { contact, settings, label } ) {
	if ( ! contact ) {
		return (
			<p className="fto-node-note">
				{ __(
					'No valid email in the test values: the record is sent without a contact.',
					'forms-to-odoo'
				) }
			</p>
		);
	}
	return (
		<>
			<div className="fto-arrow is-up">
				<span>
					{ sprintf(
						/* translators: %s: Odoo field label, e.g. Customer */
						__( 'linked in %s', 'forms-to-odoo' ),
						label
					) }
				</span>
			</div>
			<div className="fto-node is-contact">
				<div className="fto-node-head">
					<strong>{ __( 'Contact', 'forms-to-odoo' ) }</strong>
					<code>res.partner</code>
				</div>
				<dl className="fto-values">
					<div className="fto-value">
						<dt>{ __( 'Found by', 'forms-to-odoo' ) }</dt>
						<dd>{ contact.email }</dd>
					</div>
					<div className="fto-value">
						<dt>{ __( 'If none', 'forms-to-odoo' ) }</dt>
						<dd>
							{ settings.contact.create
								? [
										contact.name || contact.email,
										contact.phone,
									]
										.filter( Boolean )
										.join( ' · ' ) +
									' ' +
									__( '(created)', 'forms-to-odoo' )
								: __(
										'sent without a contact',
										'forms-to-odoo'
									) }
						</dd>
					</div>
				</dl>
			</div>
		</>
	);
}

function SummaryRow( { label, field, value, linked } ) {
	const empty = value === undefined;
	return (
		<div className={ `fto-value${ empty ? ' is-empty' : '' }` }>
			<dt>{ label }</dt>
			<dd>
				{ empty ? (
					<em>
						{ linked
							? __( 'the contact below', 'forms-to-odoo' )
							: __( 'empty, not sent', 'forms-to-odoo' ) }
					</em>
				) : (
					<ValueText field={ field } value={ value } />
				) }
			</dd>
		</div>
	);
}

// An Odoo value as people read it: labels and names instead of keys and ids
function ValueText( { field, value } ) {
	const relation =
		field && [ 'many2one', 'many2many' ].includes( field.type )
			? field.relation
			: '';
	const { records } = useRecords( relation );
	const nameOf = ( id ) =>
		records?.find( ( r ) => r.id === id )?.name || `#${ id }`;

	switch ( field?.type ) {
		case 'selection':
			return (
				( field.selection || [] ).find(
					( [ key ] ) => key === value
				)?.[ 1 ] || value
			);
		case 'many2one':
			return nameOf( value );
		case 'many2many':
			// [[6, 0, ids]]
			return ( value?.[ 0 ]?.[ 2 ] || [] ).map( nameOf ).join( ', ' );
		case 'boolean':
			return value
				? __( 'Yes', 'forms-to-odoo' )
				: __( 'No', 'forms-to-odoo' );
		case 'html': {
			// escaped text with <br>: back to plain text
			const text = document.createElement( 'textarea' );
			text.innerHTML = String( value )
				.replace( /<br\s*\/?>/g, '\n' )
				.replace( /<[^>]+>/g, '' );
			return text.value;
		}
		default:
			return String( value );
	}
}
