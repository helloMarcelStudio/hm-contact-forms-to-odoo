/**
 * One row of the mapping: an Odoo field and where its value comes from
 * (a template, a fixed choice, or the option picked in a form field).
 */
import { __ } from '@wordpress/i18n';
import apiFetch from '@wordpress/api-fetch';
import { useEffect, useState } from '@wordpress/element';
import {
	Button,
	ComboboxControl,
	FormTokenField,
	SelectControl,
	TextControl,
} from '@wordpress/components';
import { data, MULTILINE, useOdooOptions, usePanel } from './data';
import { OdooStatus, TemplateInput } from './controls';

const CHOICE_TYPES = [ 'selection', 'many2one', 'many2many' ];

export default function MappingRow( { row, setRow, onRemove, usedFields } ) {
	return (
		<tr>
			<td>
				<FieldSelect
					row={ row }
					setRow={ setRow }
					usedFields={ usedFields }
				/>
			</td>
			<td>
				{ row.field ? (
					<ValueInput row={ row } setRow={ setRow } />
				) : null }
			</td>
			<td>
				<Button
					icon="no-alt"
					isDestructive
					size="small"
					label={ __( 'Remove', 'forms-to-odoo' ) }
					onClick={ onRemove }
				/>
			</td>
		</tr>
	);
}

function FieldSelect( { row, setRow, usedFields } ) {
	const { fields } = usePanel();
	const known = ! row.field || fields[ row.field ];
	const options = Object.entries( fields )
		.filter(
			( [ name ] ) => name === row.field || ! usedFields.has( name )
		)
		.map( ( [ name, f ] ) => ( {
			value: name,
			label: `${ f.label }${ f.required ? ` (${ __( 'required', 'forms-to-odoo' ) })` : '' } — ${ name }`,
		} ) );
	if ( ! known ) {
		options.unshift( { value: row.field, label: row.field } );
	}

	return (
		<>
			<ComboboxControl
				__nextHasNoMarginBottom
				__next40pxDefaultSize
				label={ __( 'Odoo field', 'forms-to-odoo' ) }
				hideLabelFromVision
				value={ row.field || null }
				options={ options }
				onChange={ ( name ) => {
					if ( ! name || name === row.field ) {
						return;
					}
					const type = fields[ name ]?.type || 'char';
					// a new field starts from scratch: no source, map or transform
					setRow( {
						field: name,
						type,
						value: type === 'many2many' ? [] : '',
					} );
				} }
			/>
			{ ! known && (
				<div className="fto-error">
					{ __( 'Not found on this Odoo model', 'forms-to-odoo' ) }
				</div>
			) }
		</>
	);
}

function ValueInput( { row, setRow } ) {
	const { fields } = usePanel();
	const field = fields[ row.field ];
	const type = field ? field.type : row.type;

	// selection and relational fields: a fixed value, or one that depends
	// on what the visitor chose in the form
	if ( field && CHOICE_TYPES.includes( type ) ) {
		const fromForm = row.source === 'form';
		return (
			<div className="fto-stack">
				<SelectControl
					__nextHasNoMarginBottom
					__next40pxDefaultSize
					label={ __( 'Value', 'forms-to-odoo' ) }
					hideLabelFromVision
					value={ fromForm ? 'form' : 'fixed' }
					options={ [
						{
							value: 'fixed',
							label: __( 'Fixed value', 'forms-to-odoo' ),
						},
						{
							value: 'form',
							label: __( 'Map a form field', 'forms-to-odoo' ),
						},
					] }
					onChange={ ( source ) =>
						setRow( {
							field: row.field,
							type,
							value: type === 'many2many' ? [] : '',
							...( source === 'form'
								? { source: 'form', tag: '', map: {} }
								: {} ),
						} )
					}
				/>
				{ fromForm ? (
					<FormSource row={ row } setRow={ setRow } field={ field } />
				) : (
					<FixedChoice
						row={ row }
						setRow={ setRow }
						field={ field }
					/>
				) }
			</div>
		);
	}
	if ( data.textTypes.includes( type ) ) {
		return <TextValue row={ row } setRow={ setRow } type={ type } />;
	}
	return <em>{ type }</em>;
}

function FixedChoice( { row, setRow, field } ) {
	const { options, loading, error } = useOdooOptions( field );
	if ( loading || error ) {
		return <OdooStatus loading={ loading } error={ error } />;
	}

	if ( field.type === 'selection' ) {
		return (
			<SelectControl
				__nextHasNoMarginBottom
				__next40pxDefaultSize
				label={ field.label }
				hideLabelFromVision
				value={ row.value || '' }
				options={ [
					{ value: '', label: __( '— None —', 'forms-to-odoo' ) },
					...options,
				] }
				onChange={ ( value ) => setRow( { ...row, value } ) }
			/>
		);
	}
	if ( field.type === 'many2one' ) {
		return (
			<ComboboxControl
				__nextHasNoMarginBottom
				__next40pxDefaultSize
				label={ field.label }
				hideLabelFromVision
				value={ row.value ? String( row.value ) : null }
				options={ options }
				onChange={ ( value ) =>
					setRow( { ...row, value: value ? Number( value ) : 0 } )
				}
			/>
		);
	}
	return (
		<RecordTokens
			row={ row }
			setRow={ setRow }
			field={ field }
			options={ options }
		/>
	);
}

// many2many: several records, typed or picked from the list
function RecordTokens( { row, setRow, field, options } ) {
	// tokens are labels: tell same-named records apart by their id
	const counts = {};
	options.forEach(
		( o ) => ( counts[ o.label ] = ( counts[ o.label ] || 0 ) + 1 )
	);
	const labelOf = new Map(
		options.map( ( o ) => [
			o.value,
			counts[ o.label ] > 1 ? `${ o.label } (#${ o.value })` : o.label,
		] )
	);
	const idOf = new Map(
		[ ...labelOf ].map( ( [ id, label ] ) => [ label, Number( id ) ] )
	);
	const ids = ( row.value || [] ).map( Number );

	return (
		<FormTokenField
			__nextHasNoMarginBottom
			__next40pxDefaultSize
			__experimentalExpandOnFocus
			__experimentalShowHowTo={ false }
			label={ field.label }
			value={ ids.map(
				( id ) => labelOf.get( String( id ) ) || `#${ id }`
			) }
			suggestions={ [ ...idOf.keys() ] }
			onChange={ ( tokens ) =>
				setRow( {
					...row,
					value: tokens
						.map( ( t ) =>
							idOf.get( typeof t === 'string' ? t : t.value )
						)
						.filter( Boolean ),
				} )
			}
		/>
	);
}

// "Map a form field": each option of a form field → an Odoo value
function FormSource( { row, setRow, field } ) {
	const { options, loading, error } = useOdooOptions( field );
	const tagNames = Object.keys( data.choices || {} );
	if ( ! tagNames.length ) {
		return (
			<p className="description">
				{ __(
					'This form has no select, radio or checkbox field.',
					'forms-to-odoo'
				) }
			</p>
		);
	}

	const map = row.map && ! Array.isArray( row.map ) ? row.map : {};
	const setTarget = ( option, value ) => {
		const next = { ...map };
		// "0" is a valid selection key (e.g. priority), but no record id
		if ( ! value || ( value === '0' && field.type !== 'selection' ) ) {
			delete next[ option ];
		} else {
			next[ option ] =
				field.type === 'selection' ? value : Number( value );
		}
		setRow( { ...row, map: next } );
	};

	return (
		<div className="fto-stack">
			<SelectControl
				__nextHasNoMarginBottom
				__next40pxDefaultSize
				label={ __( 'Form field', 'forms-to-odoo' ) }
				value={ row.tag || '' }
				options={ [
					{ value: '', label: __( '— Choose —', 'forms-to-odoo' ) },
					...tagNames.map( ( name ) => ( {
						value: name,
						label: `[${ name }]`,
					} ) ),
				] }
				onChange={ ( tag ) => setRow( { ...row, tag, map: {} } ) }
			/>
			{ row.tag && data.choices[ row.tag ] && ( loading || error ) && (
				<OdooStatus loading={ loading } error={ error } />
			) }
			{ row.tag && data.choices[ row.tag ] && ! loading && ! error && (
				<>
					<table className="fto-choice-map">
						<thead>
							<tr>
								<th>
									{ __(
										'When the visitor chooses',
										'forms-to-odoo'
									) }
								</th>
								<th>
									{ __( 'Send to Odoo', 'forms-to-odoo' ) }
								</th>
							</tr>
						</thead>
						<tbody>
							{ data.choices[ row.tag ].map( ( option ) => (
								<tr key={ option }>
									<td>{ option }</td>
									<td>
										{ field.type === 'selection' ? (
											<SelectControl
												__nextHasNoMarginBottom
												label={ option }
												hideLabelFromVision
												value={ String(
													map[ option ] ?? ''
												) }
												options={ [
													{
														value: '',
														label: __(
															'— None —',
															'forms-to-odoo'
														),
													},
													...options,
												] }
												onChange={ ( value ) =>
													setTarget( option, value )
												}
											/>
										) : (
											<ComboboxControl
												__nextHasNoMarginBottom
												label={ option }
												hideLabelFromVision
												value={
													map[ option ]
														? String(
																map[ option ]
															)
														: null
												}
												options={ options }
												onChange={ ( value ) =>
													setTarget( option, value )
												}
											/>
										) }
									</td>
								</tr>
							) ) }
						</tbody>
					</table>
					<p className="description">
						{ __(
							'Options left empty leave the Odoo field empty.',
							'forms-to-odoo'
						) }
					</p>
				</>
			) }
		</div>
	);
}

function TextValue( { row, setRow, type } ) {
	return (
		<div className="fto-stack">
			<TemplateInput
				label={ __( 'Value', 'forms-to-odoo' ) }
				hideLabelFromVision
				multiline={ MULTILINE.includes( type ) }
				value={ row.value || '' }
				onChange={ ( value ) => setRow( { ...row, value } ) }
			/>
			{ row.transform ? (
				<>
					<Transform row={ row } setRow={ setRow } />
					<Preview row={ row } />
				</>
			) : (
				<div>
					<Button
						variant="link"
						onClick={ () =>
							setRow( {
								...row,
								transform: {
									pattern: '',
									replace: '',
									nomatch: 'keep',
								},
							} )
						}
					>
						{ '+ ' +
							__(
								'Transform (regular expression)',
								'forms-to-odoo'
							) }
					</Button>
				</div>
			) }
		</div>
	);
}

// Regex find & replace applied to the filled-in template
function Transform( { row, setRow } ) {
	const t = row.transform;
	const set = ( key ) => ( value ) =>
		setRow( { ...row, transform: { ...t, [ key ]: value } } );
	const { transform, ...withoutTransform } = row;

	return (
		<fieldset className="fto-transform">
			<legend>
				{ __( 'Transform (regular expression)', 'forms-to-odoo' ) }
			</legend>
			<TextControl
				__nextHasNoMarginBottom
				__next40pxDefaultSize
				className="code"
				label={ __( 'Find', 'forms-to-odoo' ) }
				placeholder={ __(
					'PHP regex, without delimiters, e.g. ^(\\+\\d+)\\D*?0*(\\d.*)$',
					'forms-to-odoo'
				) }
				value={ t.pattern || '' }
				onChange={ set( 'pattern' ) }
			/>
			<TextControl
				__nextHasNoMarginBottom
				__next40pxDefaultSize
				className="code"
				label={ __( 'Replace with', 'forms-to-odoo' ) }
				placeholder={ __(
					'Use $1, $2… for the captured groups',
					'forms-to-odoo'
				) }
				value={ t.replace || '' }
				onChange={ set( 'replace' ) }
			/>
			<SelectControl
				__nextHasNoMarginBottom
				__next40pxDefaultSize
				label={ __( "If it doesn't match", 'forms-to-odoo' ) }
				value={ t.nomatch === 'empty' ? 'empty' : 'keep' }
				options={ [
					{
						value: 'keep',
						label: __( 'keep the value as is', 'forms-to-odoo' ),
					},
					{
						value: 'empty',
						label: __(
							'leave the Odoo field empty',
							'forms-to-odoo'
						),
					},
				] }
				onChange={ set( 'nomatch' ) }
			/>
			<Button
				variant="link"
				isDestructive
				onClick={ () => setRow( withoutTransform ) }
			>
				{ __( 'Remove the transform', 'forms-to-odoo' ) }
			</Button>
		</fieldset>
	);
}

// Filled-in template → transformed value, computed by the server (PHP regex)
function Preview( { row } ) {
	const { samples } = usePanel();
	const [ result, setResult ] = useState( null );
	const request = JSON.stringify( {
		value: row.value,
		transform: row.transform,
	} );

	useEffect( () => {
		let live = true;
		const timer = setTimeout( () => {
			apiFetch( {
				path: '/fto/v1/preview',
				method: 'POST',
				data: { row: JSON.parse( request ), samples },
			} ).then(
				( r ) => live && setResult( r ),
				( e ) => live && setResult( { error: e.message } )
			);
		}, 250 );
		return () => {
			live = false;
			clearTimeout( timer );
		};
	}, [ request, samples ] );

	if ( ! result ) {
		return null;
	}
	const show = ( v ) =>
		v === '' ? __( '(empty, not sent)', 'forms-to-odoo' ) : v;
	return (
		<div className="fto-preview">
			<span className="description">
				{ __( 'With the test values:', 'forms-to-odoo' ) }{ ' ' }
			</span>
			<code>{ show( result.filled ?? '' ) }</code>
			{ ' → ' }
			{ result.error ? (
				<span className="fto-error">{ result.error }</span>
			) : (
				<code
					className={ result.matched === false ? 'fto-nomatch' : '' }
				>
					{ show( result.result ?? '' ) }
				</code>
			) }
		</div>
	);
}
