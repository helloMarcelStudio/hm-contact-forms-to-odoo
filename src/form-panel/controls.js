/**
 * Small building blocks of the "Odoo" tab: template inputs that the form
 * tag buttons insert into, and the loading / error state of Odoo lists.
 */
import { __ } from '@wordpress/i18n';
import { useState } from '@wordpress/element';
import {
	Button,
	CustomSelectControl,
	Popover,
	Spinner,
	TextControl,
	TextareaControl,
} from '@wordpress/components';
import { data, usePanel } from './data';

/**
 * A text template with [form-tags]. Focusing it makes it the target of
 * the tag buttons (see TagButtons).
 *
 * @param {Object}                  props
 * @param {boolean}                 props.multiline A textarea instead of a single line.
 * @param {(value: string) => void} props.onChange  Called with the new value.
 * @return {Element} The control.
 */
export function TemplateInput( { multiline = false, onChange, ...props } ) {
	const { tagTarget } = usePanel();
	const Control = multiline ? TextareaControl : TextControl;
	const sizing = multiline ? { rows: 4 } : { __next40pxDefaultSize: true };
	return (
		<Control
			__nextHasNoMarginBottom
			{ ...sizing }
			className="fto-template"
			placeholder={ __(
				'Text and [form-tags], e.g. [your-name]',
				'forms-to-odoo'
			) }
			onChange={ onChange }
			onFocus={ ( e ) => {
				tagTarget.current = { el: e.target, onChange };
			} }
			{ ...props }
		/>
	);
}

// The form's tags; a click inserts one at the caret of the focused template
export function TagButtons() {
	const { tagTarget } = usePanel();
	if ( ! data.tags?.length ) {
		return null;
	}

	const insert = ( tag ) => {
		const target = tagTarget.current;
		if ( ! target || ! document.contains( target.el ) ) {
			return;
		}
		const { el, onChange } = target;
		const text = `[${ tag }]`;
		const start = el.selectionStart ?? el.value.length;
		const end = el.selectionEnd ?? el.value.length;
		onChange( el.value.slice( 0, start ) + text + el.value.slice( end ) );
		// after React has re-rendered the value: caret right after the tag
		window.requestAnimationFrame( () => {
			el.focus();
			el.setSelectionRange( start + text.length, start + text.length );
		} );
	};

	return (
		<div className="fto-tags">
			<p className="description">
				{ __(
					'Form tags, click to insert into the focused value. A line whose tags are all empty is left out.',
					'forms-to-odoo'
				) }
			</p>
			{ data.tags.map( ( tag ) => (
				<Button
					key={ tag }
					variant="secondary"
					size="small"
					// keep the focus (and caret) in the template being edited
					onMouseDown={ ( e ) => e.preventDefault() }
					onClick={ () => insert( tag ) }
				>
					{ `[${ tag }]` }
				</Button>
			) ) }
		</div>
	);
}

// While an Odoo list loads, or why it couldn't
export function OdooStatus( { loading, error } ) {
	if ( error ) {
		return <span className="fto-error">{ error }</span>;
	}
	if ( loading ) {
		return (
			<span className="description">
				<Spinner /> { __( 'Loading from Odoo…', 'forms-to-odoo' ) }
			</span>
		);
	}
	return null;
}

/**
 * A styled dropdown (CustomSelectControl) with the SelectControl API used
 * across the tab: options as [{ value, label, hint }], onChange(value).
 * A hint, e.g. a technical name, is shown on the right of the option.
 *
 * @param {Object}                  props
 * @param {string}                  props.value    The selected value.
 * @param {Array}                   props.options  [{ value, label, hint }].
 * @param {(value: string) => void} props.onChange Called with the new value.
 * @return {Element} The control.
 */
export function Select( { value, options, onChange, ...props } ) {
	const items = options.map( ( o ) => ( {
		key: String( o.value ),
		name: o.label,
		hint: o.hint,
	} ) );
	// like a native select, show the first option when nothing matches
	const selected =
		items.find( ( item ) => item.key === String( value ?? '' ) ) ||
		items[ 0 ];
	return (
		<CustomSelectControl
			__next40pxDefaultSize
			className="fto-select"
			options={ items }
			value={ selected }
			onChange={ ( { selectedItem } ) => onChange( selectedItem.key ) }
			{ ...props }
		/>
	);
}

/**
 * An ⓘ button whose explanation opens on hover, click or keyboard focus
 * (a plain tooltip only shows after a hover delay, and never on touch).
 *
 * @param {Object} props
 * @param {string} props.text The explanation, one or two sentences.
 * @return {Element} The button and its bubble.
 */
export function HelpTip( { text } ) {
	const [ open, setOpen ] = useState( false );
	const [ anchor, setAnchor ] = useState( null );
	return (
		<span
			className="fto-helptip"
			onMouseEnter={ () => setOpen( true ) }
			onMouseLeave={ () => setOpen( false ) }
		>
			<Button
				ref={ setAnchor }
				icon="info-outline"
				size="small"
				label={ text }
				showTooltip={ false }
				aria-expanded={ open }
				onClick={ () => setOpen( ( o ) => ! o ) }
				onFocus={ () => setOpen( true ) }
				onBlur={ () => setOpen( false ) }
			/>
			{ open && (
				<Popover
					anchor={ anchor }
					placement="top"
					focusOnMount={ false }
					className="fto-helptip-popover"
					onClose={ () => setOpen( false ) }
				>
					{ text }
				</Popover>
			) }
		</span>
	);
}
